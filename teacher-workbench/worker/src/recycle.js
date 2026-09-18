/**
 * recycle.js — 回收站（§回收站）
 *
 * 约定：
 * - 所有删除内容先进回收站（payload 存全量行 JSON），可恢复，30 天后自动清除
 * - recycle_bin 表按租户所在库存储（正式=主库，试用=TRIAL_DB，迁移 0020）
 * - captureRecycle 在真正删除之前调用：查行 → captureRecycle → 原删除逻辑
 * - restoreRecycle 按原 id 逐表插回；任一表任一行 id 已存在 → 409 CONFLICT
 * - purgeRecycleBin 只清主库（定时任务里试用库随空间物理删除一并清理）
 */

import { ApiError, newId, now } from './db.js';

/** 回收站保留天数：到期自动物理清除 */
const RETENTION_DAYS = 30;

/**
 * 捕获删除内容进回收站（幂等：同 tenant+type+item 已存在则先删旧行再插）。
 * @param {object} db 租户库 D1 binding（c.get('tenantDb') || c.env.DB）
 * @param {string} tenantId
 * @param {string} userId 删除人
 * @param {string} itemType lesson/student/assignment/dictation/exam
 * @param {string} itemId 被删条目原 id
 * @param {string} title 条目名（展示用）
 * @param {Object<string, Array<object>>} tables { 表名: [行...] } 全量行快照
 */
export async function captureRecycle(db, tenantId, userId, itemType, itemId, title, tables) {
  await db
    .prepare('DELETE FROM recycle_bin WHERE tenant_id = ? AND item_type = ? AND item_id = ?')
    .bind(tenantId, itemType, itemId)
    .run();
  await db
    .prepare(
      `INSERT INTO recycle_bin (id, tenant_id, item_type, item_id, title, payload, deleted_by, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(newId(), tenantId, itemType, itemId, title ?? null, JSON.stringify({ tables }), userId, now())
    .run();
}

/**
 * 恢复回收站条目：把 payload.tables 各行按原 id 逐表插回。
 * 任一表任一行 id 已存在 → 抛 409 CONFLICT（原删除逻辑未执行，回收站条目保留）。
 * @param {object} db 租户库 D1 binding
 * @param {object} entry recycle_bin 行（含 payload）
 * @returns {Promise<{tables: Object<string, number>}> 各表恢复行数
 * @throws {ApiError} CONFLICT（原条目已存在）
 */
export async function restoreRecycle(db, entry) {
  let payload;
  try {
    payload = JSON.parse(entry.payload);
  } catch {
    throw new ApiError('BAD_REQUEST', '回收站数据损坏，无法恢复');
  }
  const tables = payload && typeof payload === 'object' ? payload.tables || {} : {};

  // 先全量校验：任一表任一行 id 已存在 → 409（不写任何行，保证不半恢复）
  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const placeholders = rows.map(() => '?').join(',');
    const dup = await db
      .prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders}) LIMIT 1`)
      .bind(...rows.map((r) => r.id))
      .first();
    if (dup) {
      throw new ApiError('CONFLICT', '无法恢复：原条目已存在（可能已重新创建过）');
    }
  }

  // 逐表 INSERT（全部 batch 一次提交）
  const restored = {};
  const stmts = [];
  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const colList = cols.join(', ');
    const rowPh = rows
      .map(() => `(${cols.map(() => '?').join(', ')})`)
      .join(', ');
    const values = rows.flatMap((r) => cols.map((col) => (r[col] === undefined ? null : r[col])));
    stmts.push(db.prepare(`INSERT INTO ${table} (${colList}) VALUES ${rowPh}`).bind(...values));
    restored[table] = rows.length;
  }
  if (stmts.length) await db.batch(stmts);
  return { tables: restored };
}

/**
 * 清理主库回收站中超过 30 天的条目（scheduled 定时调用）。
 * 只清主库：试用库的空间到期会整体物理删除（trial.js purgeExpiredTrials）。
 * @param {object} env Worker env（用 env.DB）
 * @returns {Promise<number>} 清理行数
 */
export async function purgeRecycleBin(env) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const res = await env.DB.prepare('DELETE FROM recycle_bin WHERE deleted_at < ?')
    .bind(cutoff)
    .run();
  return res.meta?.changes ?? 0;
}
