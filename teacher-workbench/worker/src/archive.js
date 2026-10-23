/**
 * archive.js — 学年数据归档（上一学年默写/作业/考试压缩归档）
 *
 * 背景：学年 9 月 1 日起始。每年 10 月 1 日（北京时间凌晨，见 wrangler.toml [triggers]）
 * 定时任务归档上一学年三个模块：
 * - 主表行（dictations/assignments/exams）保留，汇总统计 JSON 写入 archived_stats 新列；
 * - 子表明细行（dictation_results / assignment_submissions / exam_scores+exam_subscores）
 *   全部删除；
 * - 完整明细（列表 DTO 行 + 子表原始行）gzip+base64 存入 year_archives.payload，
 *   仅供租户管理员通过 GET /api/v1/archive/download 下载后离线解压；
 * - 查看历史学年列表 = 普通列表查询直接读主表删减行（archived_stats 提供留存统计），
 *   不再走解压还原。教案（lessons）与备课素材不参与归档，自动带到新学年。
 */

import { newId, now, currentAcademicYear } from './db.js';

/** 可归档模块（与 year_archives.module 取值一致） */
export const ARCHIVE_MODULES = ['dictations', 'assignments', 'exams'];

/**
 * 上一学年：currentAcademicYear() 返回 'Y-(Y+1)'，上一学年即 '(Y-1)-Y'。
 * @returns {string} 如 '2024-2025'
 */
export function previousAcademicYear() {
  const [start, end] = currentAcademicYear().split('-').map(Number);
  return `${start - 1}-${end - 1}`;
}

/**
 * 是否处于归档提醒窗口：东八区当前月日落在 9/15–9/30（含首尾）。
 * 东八区算法与 db.js currentAcademicYear() 保持一致（UTC + 8h 后取 UTC 月/日）。
 * @returns {boolean}
 */
export function isRemindWindow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCMonth() === 8 && d.getUTCDate() >= 15 && d.getUTCDate() <= 30;
}

/** Uint8Array → base64（分块 0x8000，避免 String.fromCharCode 栈溢出） */
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** 文本 → gzip+base64 */
export async function gzipText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

/**
 * 全年段默写下派进度 —— 需与 routes/dictations.js 的 classProgressOf 保持一致。
 * total=该班该学年学生数；registered=已有默写结果的学生数。
 * 归档时子表尚未删除，可正常计算；payload items 里留存供离线查看。
 */
async function classProgressOfArchive(db, tenantId, dictationId, academicYear) {
  const rows = await db
    .prepare(
      `SELECT c.id, c.name, COUNT(s.id) AS total, COUNT(r.student_id) AS registered
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.id AND s.academic_year = ?
       LEFT JOIN dictation_results r ON r.dictation_id = ? AND r.student_id = s.id
       WHERE c.tenant_id = ? AND c.academic_year = ?
       GROUP BY c.id
       ORDER BY c.created_at`
    )
    .bind(academicYear, dictationId, tenantId, academicYear)
    .all();
  return rows.results.map((r) => ({
    classId: r.id,
    className: r.name,
    total: r.total || 0,
    registered: r.registered || 0,
  }));
}

/**
 * 各模块归档时的主表查询：统计子查询的 SQL 与口径必须与对应路由 GET / 完全一致
 * （routes/dictations.js / routes/assignments.js / routes/exams.js），
 * 保证写入 archived_stats 的汇总与归档前列表展示完全相同。归档查询不带 class_id 过滤
 * （按学年全量归档）。路由列表结构如有调整，必须同步修改这里。
 */
const MAIN_QUERIES = {
  dictations: `SELECT d.*,
     (SELECT COUNT(*) FROM dictation_results r
       WHERE r.dictation_id = d.id) AS registered_count,
     (SELECT COUNT(*) FROM dictation_results r
       WHERE r.dictation_id = d.id AND r.passed = 1) AS passed_count,
     (SELECT COUNT(*) FROM dictation_results r
       WHERE r.dictation_id = d.id AND r.passed = 0) AS failed_count,
     (SELECT COUNT(*) FROM dictation_results r
       WHERE r.dictation_id = d.id AND r.passed = 0 AND r.retest_completed = 0) AS retest_required_count,
     (SELECT COUNT(*) FROM dictation_results r
       WHERE r.dictation_id = d.id AND r.retest_completed = 1) AS retest_completed_count
   FROM dictations d
   WHERE d.tenant_id = ? AND d.academic_year = ?
   ORDER BY d.dictation_date DESC, d.created_at DESC`,
  assignments: `SELECT a.*,
     (SELECT COUNT(*) FROM students s
       WHERE s.tenant_id = a.tenant_id AND s.class_id = a.class_id) AS total_count,
     (SELECT COUNT(*) FROM assignment_submissions x
       WHERE x.assignment_id = a.id AND x.status = 'submitted') AS submitted_count,
     (SELECT COUNT(*) FROM assignment_submissions x
       WHERE x.assignment_id = a.id AND x.status = 'missing') AS missing_count,
     (SELECT COUNT(*) FROM assignment_submissions x
       WHERE x.assignment_id = a.id AND x.status = 'pending') AS pending_count
   FROM assignments a
   WHERE a.tenant_id = ? AND a.academic_year = ?
   ORDER BY a.created_at DESC`,
  exams: `SELECT e.*, cl.name AS class_name,
     (SELECT COUNT(*) FROM exam_scores s WHERE s.exam_id = e.id AND s.score IS NOT NULL AND s.absent = 0) AS student_count,
     (SELECT ROUND(AVG(s.score), 2) FROM exam_scores s
       WHERE s.exam_id = e.id AND s.score IS NOT NULL AND s.absent = 0) AS avg_score
   FROM exams e
   LEFT JOIN classes cl ON cl.id = e.class_id AND cl.tenant_id = e.tenant_id
   WHERE e.tenant_id = ? AND e.academic_year = ?
   ORDER BY e.exam_date DESC, e.created_at DESC`,
};

/** 各模块子表配置：子表名 → 外键列名（查出原始行进 payload.children，归档后删除） */
const CHILD_TABLES = {
  dictations: { dictation_results: 'dictation_id' },
  assignments: { assignment_submissions: 'assignment_id' },
  exams: { exam_scores: 'exam_id', exam_subscores: 'exam_id' },
};

/** 主表行 → archived_stats 汇总 JSON（口径与 routes 子查询一致） */
function buildArchivedStats(module, r) {
  if (module === 'dictations') {
    return {
      registered: r.registered_count || 0,
      passed: r.passed_count || 0,
      failed: r.failed_count || 0,
      retestRequired: r.retest_required_count || 0,
      retestCompleted: r.retest_completed_count || 0,
    };
  }
  if (module === 'assignments') {
    const total = r.total_count || 0;
    const submitted = r.submitted_count || 0;
    return {
      total,
      submitted,
      // 与 routes 一致：missing 含 missing + pending
      missing: (r.missing_count || 0) + (r.pending_count || 0),
    };
  }
  // exams：avg 已由 SQL ROUND 2 位；无成绩为 null
  return { studentCount: r.student_count || 0, avgScore: r.avg_score ?? null };
}

/** payload.items 的列表 DTO 行（与路由 GET / 行形状一致，额外注入 archived:true） */
async function buildItems(db, tenantId, module, mainRows) {
  if (module === 'dictations') {
    const list = mainRows.map((r) => ({
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
    for (const item of list) {
      if (item.scope === 'grade') {
        item.classProgress = await classProgressOfArchive(db, tenantId, item.id, item.academicYear);
      }
    }
    return list;
  }
  if (module === 'assignments') {
    return mainRows.map((r) => {
      const total = r.total_count || 0;
      const submitted = r.submitted_count || 0;
      return {
        id: r.id,
        classId: r.class_id,
        title: r.title,
        content: r.content,
        deadline: r.deadline,
        status: r.status,
        academicYear: r.academic_year,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        stats: {
          total,
          submitted,
          missing: (r.missing_count || 0) + (r.pending_count || 0),
          submitRate: total > 0 ? Math.round((submitted / total) * 100) / 100 : 0,
        },
      };
    });
  }
  // 考试列表端点为裸数组（原始行含 class_name/student_count/avg_score），归档保持同样的行形状
  return mainRows;
}

const CHUNK = 400; // D1 单语句变量数有限，IN(...) 分块查询/删除

/** 分块查出某模块全部子表原始行：{ 子表名: [原始行...] }（供 payload.children） */
async function fetchChildRows(db, tenantId, module, mainIds) {
  const children = {};
  for (const [table, fk] of Object.entries(CHILD_TABLES[module])) {
    const rows = [];
    for (let i = 0; i < mainIds.length; i += CHUNK) {
      const part = mainIds.slice(i, i + CHUNK);
      const ph = part.map(() => '?').join(',');
      const res = await db
        .prepare(`SELECT * FROM ${table} WHERE tenant_id = ? AND ${fk} IN (${ph})`)
        .bind(tenantId, ...part)
        .all();
      rows.push(...res.results);
    }
    children[table] = rows;
  }
  return children;
}

/** 分块 db.batch 写入主表行 archived_stats（归档后列表统计的唯一来源） */
async function writeArchivedStats(db, tenantId, module, statsById) {
  const table = module;
  const entries = Object.entries(statsById);
  for (let i = 0; i < entries.length; i += 100) {
    const statements = entries.slice(i, i + 100).map(([id, stats]) =>
      db
        .prepare(`UPDATE ${table} SET archived_stats = ? WHERE tenant_id = ? AND id = ?`)
        .bind(JSON.stringify(stats), tenantId, id)
    );
    await db.batch(statements);
  }
}

/** 归档后删除子表明细行（主表行保留，不再删除） */
async function deleteChildRows(db, tenantId, module, mainIds) {
  for (let i = 0; i < mainIds.length; i += CHUNK) {
    const part = mainIds.slice(i, i + CHUNK);
    const ph = part.map(() => '?').join(',');
    for (const [table, fk] of Object.entries(CHILD_TABLES[module])) {
      await db
        .prepare(`DELETE FROM ${table} WHERE tenant_id = ? AND ${fk} IN (${ph})`)
        .bind(tenantId, ...part)
        .run();
    }
  }
}

/**
 * 归档单模块：已归档（幂等）或无主表行时跳过；否则写入汇总 → 压缩明细入库 → 删除子表。
 * @returns {Promise<{module:string, archived:boolean, item_count:number}>}
 */
async function archiveModule(db, tenantId, academicYear, module) {
  const existing = await db
    .prepare('SELECT id FROM year_archives WHERE tenant_id = ? AND module = ? AND academic_year = ?')
    .bind(tenantId, module, academicYear)
    .first();
  if (existing) return { module, archived: false, item_count: 0 };

  const mainRes = await db
    .prepare(MAIN_QUERIES[module])
    .bind(tenantId, academicYear)
    .all();
  const mainRows = mainRes.results;
  if (mainRows.length === 0) return { module, archived: false, item_count: 0 };

  const mainIds = mainRows.map((r) => r.id);
  const statsById = {};
  for (const r of mainRows) statsById[r.id] = buildArchivedStats(module, r);

  // 子表原始行先全量查出（供 payload.children），再写汇总、压缩、删子表
  const children = await fetchChildRows(db, tenantId, module, mainIds);
  const items = await buildItems(db, tenantId, module, mainRows);
  for (const item of items) item.archived = true;

  await writeArchivedStats(db, tenantId, module, statsById);

  const archivedAt = now();
  const payload = await gzipText(JSON.stringify({ version: 1, archivedAt, items, children }));
  await db
    .prepare(
      `INSERT INTO year_archives (id, tenant_id, module, academic_year, payload, item_count, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(newId(), tenantId, module, academicYear, payload, items.length, archivedAt)
    .run();

  await deleteChildRows(db, tenantId, module, mainIds);
  return { module, archived: true, item_count: items.length };
}

/**
 * 归档指定租户指定学年的三个模块（dictations/assignments/exams）。
 * @returns {Promise<Array<{module:string, archived:boolean, item_count:number}>>}
 */
export async function archiveTenantYear(db, tenantId, academicYear) {
  const results = [];
  for (const module of ARCHIVE_MODULES) {
    results.push(await archiveModule(db, tenantId, academicYear, module));
  }
  return results;
}

/**
 * 归档所有在该学年有数据的租户（定时任务与平台管理员手动触发共用）。
 * 单租户失败不中断其他租户。
 * @returns {Promise<{academicYear:string, total:number, archived:number, failed:number, tenants:Array}>}
 */
export async function archiveAllTenants(env, academicYear = previousAcademicYear()) {
  const db = env.DB;
  const res = await db
    .prepare(
      `SELECT DISTINCT tenant_id FROM (
         SELECT tenant_id FROM dictations WHERE academic_year = ?
         UNION SELECT tenant_id FROM assignments WHERE academic_year = ?
         UNION SELECT tenant_id FROM exams WHERE academic_year = ?
       )`
    )
    .bind(academicYear, academicYear, academicYear)
    .all();

  const summary = { academicYear, total: res.results.length, archived: 0, failed: 0, tenants: [] };
  for (const row of res.results) {
    try {
      const results = await archiveTenantYear(db, row.tenant_id, academicYear);
      summary.archived += 1;
      summary.tenants.push({ tenantId: row.tenant_id, ok: true, results });
    } catch (err) {
      summary.failed += 1;
      summary.tenants.push({ tenantId: row.tenant_id, ok: false, error: String(err?.message || err) });
      console.error(`[archive] 租户 ${row.tenant_id} 学年 ${academicYear} 归档失败:`, err);
    }
  }
  console.log(
    `[archive] 学年 ${academicYear} 归档完成：成功 ${summary.archived}/${summary.total}` +
      (summary.failed ? `，失败 ${summary.failed}` : '')
  );
  return summary;
}

/**
 * 归档状态（供 GET /api/v1/archive/status）：
 * { previousYear, compressAt: '10-01', hasArchivable, remindWindow }。
 * hasArchivable = 上一学年存在 archived_stats IS NULL 的主表行（即还有未归档明细）；
 * remindWindow 还需处于 9/15–9/30（东八区）。
 */
export async function getArchiveStatus(db, tenantId) {
  const previousYear = previousAcademicYear();
  const counts = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM dictations WHERE tenant_id = ? AND academic_year = ? AND archived_stats IS NULL) AS d,
         (SELECT COUNT(*) FROM assignments WHERE tenant_id = ? AND academic_year = ? AND archived_stats IS NULL) AS a,
         (SELECT COUNT(*) FROM exams WHERE tenant_id = ? AND academic_year = ? AND archived_stats IS NULL) AS e`
    )
    .bind(tenantId, previousYear, tenantId, previousYear, tenantId, previousYear)
    .first();
  const hasArchivable = (counts?.d || 0) + (counts?.a || 0) + (counts?.e || 0) > 0;
  return {
    previousYear,
    compressAt: '10-01',
    hasArchivable,
    remindWindow: hasArchivable && isRemindWindow(),
  };
}
