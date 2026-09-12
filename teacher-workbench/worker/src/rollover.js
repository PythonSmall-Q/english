/**
 * rollover.js — 学年初自动结转 + 毕业班级归档
 *
 * 每年 9 月 1 日（北京时间凌晨，见 wrangler.toml [triggers]）定时任务执行：
 * - 结转：非毕业班级（graduation_year 为空或 > 新学年首位年份）的 classes.academic_year
 *   与其学生的 students.academic_year 更新为当前学年；
 * - 毕业归档：graduation_year == 新学年首位年份（如 2027-2028 学年的 2027）的班级
 *   整体压缩打包（班级+学生+作业及提交+默写及结果+考试及成绩小分，全部该班数据）
 *   写入独立的第二个 D1 数据库 GRAD_DB（graduated_archives），全部成功后再从主库删除
 *   该班全部数据。毕业后平台内不可查看任何内容，只有元数据列表和下载。
 *
 * 单班失败不中断其余班级/租户；压缩复用 archive.js 的 gzipText（gzip+base64）。
 */

import { newId, now, currentAcademicYear } from './db.js';
import { gzipText } from './archive.js';

const CHUNK = 400; // D1 单语句变量数有限，IN(...) 分块查询/删除

/** 按学生 id 集合分块执行 SELECT/DELETE（IN 防超限） */
async function runByStudentChunks(db, sql, tenantId, studentIds) {
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const part = studentIds.slice(i, i + CHUNK);
    const ph = part.map(() => '?').join(',');
    await db.prepare(sql.replace('__IN__', ph)).bind(tenantId, ...part).run();
  }
}

/**
 * 毕业归档单个班级：组装 payload → 压缩写入 GRAD_DB → 全部成功后再删主库。
 * @returns {Promise<string>} 班级名
 */
async function graduateClass(db, gradDb, tenantId, cls, studentRows) {
  if (!gradDb) throw new Error('GRAD_DB 未配置（毕业数据库缺失）');
  const studentIds = studentRows.map((s) => s.id);

  // 本班 class-scope 条目
  const assignments = (
    await db.prepare('SELECT * FROM assignments WHERE tenant_id = ? AND class_id = ?').bind(tenantId, cls.id).all()
  ).results;
  const classDictations = (
    await db
      .prepare("SELECT * FROM dictations WHERE tenant_id = ? AND class_id = ? AND scope = 'class'")
      .bind(tenantId, cls.id)
      .all()
  ).results;
  const classExams = (
    await db
      .prepare("SELECT * FROM exams WHERE tenant_id = ? AND class_id = ? AND scope = 'class'")
      .bind(tenantId, cls.id)
      .all()
  ).results;

  // grade-scope 条目中被该班学生结果引用到的（全年段条目保留，但其子表行随学生删除）
  let gradeDictations = [];
  let gradeExams = [];
  if (studentIds.length > 0) {
    const dictationIds = [];
    const examIds = [];
    for (let i = 0; i < studentIds.length; i += CHUNK) {
      const part = studentIds.slice(i, i + CHUNK);
      const ph = part.map(() => '?').join(',');
      const dres = await db
        .prepare(
          `SELECT DISTINCT r.dictation_id AS id FROM dictation_results r
            JOIN dictations d ON d.id = r.dictation_id AND d.tenant_id = r.tenant_id
           WHERE r.tenant_id = ? AND d.scope = 'grade' AND r.student_id IN (${ph})`
        )
        .bind(tenantId, ...part)
        .all();
      dictationIds.push(...dres.results.map((r) => r.id));
      const eres = await db
        .prepare(
          `SELECT DISTINCT r.exam_id AS id FROM exam_scores r
            JOIN exams e ON e.id = r.exam_id AND e.tenant_id = r.tenant_id
           WHERE r.tenant_id = ? AND e.scope = 'grade' AND r.student_id IN (${ph})`
        )
        .bind(tenantId, ...part)
        .all();
      examIds.push(...eres.results.map((r) => r.id));
    }
    if (dictationIds.length > 0) {
      const ph = dictationIds.map(() => '?').join(',');
      gradeDictations = (
        await db.prepare(`SELECT * FROM dictations WHERE tenant_id = ? AND id IN (${ph})`).bind(tenantId, ...dictationIds).all()
      ).results;
    }
    if (examIds.length > 0) {
      const ph = examIds.map(() => '?').join(',');
      gradeExams = (
        await db.prepare(`SELECT * FROM exams WHERE tenant_id = ? AND id IN (${ph})`).bind(tenantId, ...examIds).all()
      ).results;
    }
  }

  // 子表明细（该班学生）
  const children = {};
  const childSpecs = [
    ['assignment_submissions', 'SELECT * FROM assignment_submissions WHERE tenant_id = ? AND student_id IN (__IN__)'],
    ['dictation_results', 'SELECT * FROM dictation_results WHERE tenant_id = ? AND student_id IN (__IN__)'],
    ['exam_scores', 'SELECT * FROM exam_scores WHERE tenant_id = ? AND student_id IN (__IN__)'],
    ['exam_subscores', 'SELECT * FROM exam_subscores WHERE tenant_id = ? AND student_id IN (__IN__)'],
  ];
  for (const [table, sql] of childSpecs) {
    const rows = [];
    if (studentIds.length > 0) {
      for (let i = 0; i < studentIds.length; i += CHUNK) {
        const part = studentIds.slice(i, i + CHUNK);
        const ph = part.map(() => '?').join(',');
        const res = await db.prepare(sql.replace('__IN__', ph)).bind(tenantId, ...part).all();
        rows.push(...res.results);
      }
    }
    if (rows.length > 0) children[table] = rows;
  }

  // payload：{ version, archivedAt, class, students, items, children }（空数组键省略）
  const archivedAt = now();
  const items = {};
  if (assignments.length > 0) items.assignments = assignments;
  const dictations = [...classDictations, ...gradeDictations];
  if (dictations.length > 0) items.dictations = dictations;
  const exams = [...classExams, ...gradeExams];
  if (exams.length > 0) items.exams = exams;

  const payload = { version: 1, archivedAt, class: cls, students: studentRows, items, children };
  const payloadGz = await gzipText(JSON.stringify(payload));

  // 先完整写入毕业库，全部成功后再删主库
  await gradDb
    .prepare(
      `INSERT INTO graduated_archives (id, tenant_id, class_id, class_name, graduation_year, academic_year, payload, student_count, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(newId(), tenantId, cls.id, cls.name, cls.graduation_year ?? null, cls.academic_year, payloadGz, studentRows.length, archivedAt)
    .run();

  // 删主库：子表（该班学生）→ 本班 class-scope 条目 → 任课老师记录 → 学生行 → 班级行
  if (studentIds.length > 0) {
    await runByStudentChunks(db, 'DELETE FROM assignment_submissions WHERE tenant_id = ? AND student_id IN (__IN__)', tenantId, studentIds);
    await runByStudentChunks(db, 'DELETE FROM dictation_results WHERE tenant_id = ? AND student_id IN (__IN__)', tenantId, studentIds);
    await runByStudentChunks(db, 'DELETE FROM exam_scores WHERE tenant_id = ? AND student_id IN (__IN__)', tenantId, studentIds);
    await runByStudentChunks(db, 'DELETE FROM exam_subscores WHERE tenant_id = ? AND student_id IN (__IN__)', tenantId, studentIds);
  }
  await db.prepare('DELETE FROM assignments WHERE tenant_id = ? AND class_id = ?').bind(tenantId, cls.id).run();
  await db.prepare("DELETE FROM dictations WHERE tenant_id = ? AND class_id = ? AND scope = 'class'").bind(tenantId, cls.id).run();
  await db.prepare("DELETE FROM exams WHERE tenant_id = ? AND class_id = ? AND scope = 'class'").bind(tenantId, cls.id).run();
  await db.prepare('DELETE FROM class_teachers WHERE tenant_id = ? AND class_id = ?').bind(tenantId, cls.id).run();
  await db.prepare('DELETE FROM students WHERE tenant_id = ? AND class_id = ?').bind(tenantId, cls.id).run();
  await db.prepare('DELETE FROM classes WHERE id = ? AND tenant_id = ?').bind(cls.id, tenantId).run();

  return cls.name;
}

/** 结转单个班级：班级与学生 academic_year 更新为新学年（仅该租户） */
async function rolloverClass(db, tenantId, cls, newYear) {
  const ts = now();
  await db
    .prepare('UPDATE classes SET academic_year = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(newYear, ts, cls.id, tenantId)
    .run();
  await db
    .prepare('UPDATE students SET academic_year = ?, updated_at = ? WHERE tenant_id = ? AND class_id = ?')
    .bind(newYear, ts, tenantId, cls.id)
    .run();
  return cls.name;
}

/**
 * 对单租户执行结转+毕业归档：扫描 academic_year !== newYear 的班级，
 * 毕业班归档（graduation_year === Y0），其余班级结转。单班失败不中断。
 * @returns {Promise<{tenant_id:string, rolled:string[], graduated:string[], failed:string[]}>}
 */
export async function rolloverTenant(env, tenantId, newYear = currentAcademicYear()) {
  const db = env.DB;
  const gradDb = env.GRAD_DB || null;
  const y0 = Number(newYear.split('-')[0]);

  const rows = await db
    .prepare('SELECT * FROM classes WHERE tenant_id = ? AND academic_year <> ? ORDER BY created_at')
    .bind(tenantId, newYear)
    .all();

  const result = { tenant_id: tenantId, rolled: [], graduated: [], failed: [] };
  for (const cls of rows.results) {
    try {
      if (cls.graduation_year != null && cls.graduation_year === y0) {
        // 学生 id 集合先查出（含 0 学生班级，归档空学生包）
        const studentRows = (
          await db.prepare('SELECT * FROM students WHERE tenant_id = ? AND class_id = ? ORDER BY created_at').bind(tenantId, cls.id).all()
        ).results;
        result.graduated.push(await graduateClass(db, gradDb, tenantId, cls, studentRows));
      } else {
        result.rolled.push(await rolloverClass(db, tenantId, cls, newYear));
      }
    } catch (err) {
      result.failed.push(cls.name);
      console.error(`[rollover] 租户 ${tenantId} 班级 ${cls.name} 处理失败:`, err);
    }
  }
  return result;
}

/**
 * 学年初结转入口（定时任务与平台管理员手动触发共用）。
 * @param {object} env Worker env（DB / GRAD_DB）
 * @param {object} [options] { tenantId?: 指定租户, academicYear?: 目标学年（缺省当前学年）}
 * @returns {Promise<{academicYear:string, tenants:Array}>}
 */
export async function rolloverTenants(env, options = {}) {
  const db = env.DB;
  const newYear = options.academicYear || currentAcademicYear();
  if (!/^\d{4}-\d{4}$/.test(newYear) || Number(newYear.split('-')[1]) !== Number(newYear.split('-')[0]) + 1) {
    throw new Error(`academic_year 格式非法：${newYear}（应为 YYYY-YYYY）`);
  }

  let tenantIds;
  if (options.tenantId) {
    const tenant = await db.prepare('SELECT id FROM tenants WHERE id = ?').bind(options.tenantId).first();
    if (!tenant) throw new Error(`租户不存在：${options.tenantId}`);
    tenantIds = [options.tenantId];
  } else {
    const rows = await db
      .prepare('SELECT DISTINCT tenant_id FROM classes WHERE academic_year <> ?')
      .bind(newYear)
      .all();
    tenantIds = rows.results.map((r) => r.tenant_id);
  }

  const tenants = [];
  for (const tenantId of tenantIds) {
    try {
      tenants.push(await rolloverTenant(env, tenantId, newYear));
    } catch (err) {
      console.error(`[rollover] 租户 ${tenantId} 结转失败:`, err);
      tenants.push({ tenant_id: tenantId, rolled: [], graduated: [], failed: [], error: String(err?.message || err) });
    }
  }
  console.log(
    `[rollover] 学年 ${newYear} 结转完成：租户 ${tenants.length}` +
      tenants.map((t) => `，${t.tenant_id} 结转 ${t.rolled.length} 班/毕业 ${t.graduated.length} 班/失败 ${(t.failed || []).length} 班`).join('')
  );
  return { academicYear: newYear, tenants };
}
