/**
 * routes/exams.js — 考试与成绩分析路由（§35/§36/§37/§38）
 *
 * 约定：
 * - 读操作 viewer 起；写操作（新建/编辑/删除/导入）teacher 起
 * - 成绩导入匹配优先级：学号精确 → 姓名+班级名（均限 tenant 内）；未匹配行不写入
 * - 导入/级联删除使用 db.batch 保证事务性（§79）
 * - 分数段口径：<60 / 60-69.9 / 70-79.9 / 80-89.9 / ≥90
 * - 薄弱题型口径：得分率（score/max_score）低于 60%
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { ApiError, newId, now } from '../db.js';
import { checkQuota } from '../quota.js';

const app = new Hono();

/** 保留两位小数（输出统计用） */
const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/** 查询租户内考试，不存在抛 NOT_FOUND */
async function getExam(db, tenantId, examId) {
  const exam = await db
    .prepare('SELECT * FROM exams WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, examId)
    .first();
  if (!exam) throw new ApiError('NOT_FOUND', '考试不存在');
  return exam;
}

/** 查询考试分数名单（join 学生/班级，按分数降序） */
function listScoresStmt(db, tenantId, examId) {
  return db
    .prepare(
      `SELECT s.id, s.score, s.student_id, s.created_at,
              st.name AS student_name, st.student_no, st.class_id,
              c.name AS class_name
       FROM exam_scores s
       JOIN students st ON st.id = s.student_id
       LEFT JOIN classes c ON c.id = st.class_id
       WHERE s.tenant_id = ? AND s.exam_id = ?
       ORDER BY s.score DESC`
    )
    .bind(tenantId, examId);
}

/**
 * GET /api/v1/exams — 考试列表（附每场考试的人数与均分）
 */
app.get('/', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const rows = await db
    .prepare(
      `SELECT e.*,
              (SELECT COUNT(*) FROM exam_scores s WHERE s.exam_id = e.id) AS student_count,
              (SELECT ROUND(AVG(s.score), 2) FROM exam_scores s
                WHERE s.exam_id = e.id AND s.score IS NOT NULL) AS avg_score
       FROM exams e
       WHERE e.tenant_id = ?
       ORDER BY e.exam_date DESC, e.created_at DESC`
    )
    .bind(tenantId)
    .all();
  return c.json({ success: true, data: rows.results });
});

/**
 * POST /api/v1/exams — 新建考试（§36，需 exams 配额）
 * body: { name(必填), subject?, exam_date? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

  const name = String(body.name || '').trim();
  if (!name) throw new ApiError('VALIDATION_ERROR', '考试名称不能为空');
  const subject = body.subject ? String(body.subject).trim() : null;
  const examDate = body.exam_date ? String(body.exam_date).trim() : null;

  await checkQuota(db, tenantId, 'exams');

  const id = newId();
  await db
    .prepare(
      `INSERT INTO exams (id, tenant_id, name, subject, exam_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, name, subject, examDate, now())
    .run();
  await audit(db, tenantId, user.id, 'create_exam', '考试', id, { name });
  const exam = await getExam(db, tenantId, id);
  return c.json({ success: true, data: exam }, 201);
});

/**
 * GET /api/v1/exams/:id — 考试详情 + 分数名单
 */
app.get('/:id', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const exam = await getExam(db, tenantId, c.req.param('id'));
  const scores = await listScoresStmt(db, tenantId, exam.id).all();
  return c.json({ success: true, data: { ...exam, scores: scores.results } });
});

/**
 * PUT /api/v1/exams/:id — 编辑考试（name/subject/exam_date）
 */
app.put('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const exam = await getExam(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const name = body.name !== undefined ? String(body.name).trim() : exam.name;
  if (!name) throw new ApiError('VALIDATION_ERROR', '考试名称不能为空');
  const subject = body.subject !== undefined ? String(body.subject).trim() : exam.subject;
  const examDate = body.exam_date !== undefined ? String(body.exam_date).trim() : exam.exam_date;

  await db
    .prepare('UPDATE exams SET name = ?, subject = ?, exam_date = ? WHERE tenant_id = ? AND id = ?')
    .bind(name, subject, examDate, tenantId, exam.id)
    .run();
  await audit(db, tenantId, user.id, 'update_exam', '考试', exam.id, { name });
  return c.json({ success: true, data: await getExam(db, tenantId, exam.id) });
});

/**
 * DELETE /api/v1/exams/:id — 删除考试（物理删除，级联删小分/分数/考试本身，db.batch 事务）
 */
app.delete('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const exam = await getExam(db, tenantId, c.req.param('id'));

  await db.batch([
    db
      .prepare('DELETE FROM exam_subscores WHERE tenant_id = ? AND exam_id = ?')
      .bind(tenantId, exam.id),
    db
      .prepare('DELETE FROM exam_scores WHERE tenant_id = ? AND exam_id = ?')
      .bind(tenantId, exam.id),
    db
      .prepare('DELETE FROM exams WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, exam.id),
  ]);
  await audit(db, tenantId, user.id, 'delete_exam', '考试', exam.id, { name: exam.name });
  return c.json({ success: true, data: { id: exam.id } });
});

/**
 * 导入行 → 学生匹配：学号精确 → 姓名+班级名（tenant 内）。
 * @param {object} row 导入行
 * @param {Map} byNo 学号 → 学生
 * @param {Map} byNameClass "姓名|班级名" → 学生
 */
function matchStudent(row, byNo, byNameClass) {
  const no = row.studentNo !== undefined && row.studentNo !== null ? String(row.studentNo).trim() : '';
  if (no && byNo.has(no)) return byNo.get(no);
  const name = row.name !== undefined && row.name !== null ? String(row.name).trim() : '';
  const className =
    row.className !== undefined && row.className !== null ? String(row.className).trim() : '';
  if (name && className && byNameClass.has(`${name}|${className}`)) {
    return byNameClass.get(`${name}|${className}`);
  }
  return null;
}

/**
 * POST /api/v1/exams/:id/import — 导入总分/小分
 * body: { type: 'scores' | 'subscores', rows: [...] }
 *   scores 行    = { studentNo 或 name+className, score }
 *   subscores 行 = { studentNo 或 name+className, questionType, score, maxScore }
 * 已存在则更新（scores 按 exam+student 唯一；subscores 按 exam+student+question_type 唯一）。
 * 返回 { created, updated, failed, unmatched }，未匹配/非法行不写入。
 */
app.post('/:id/import', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const exam = await getExam(db, tenantId, c.req.param('id'));

  const body = await c.req.json().catch(() => ({}));
  const type = body.type;
  if (type !== 'scores' && type !== 'subscores') {
    throw new ApiError('VALIDATION_ERROR', "type 必须为 'scores' 或 'subscores'");
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'rows 必须是非空数组');
  }

  // 一次性加载 tenant 内全部学生（含班级名），构建两种匹配索引
  const studentRows = await db
    .prepare(
      `SELECT s.id, s.student_no, s.name, s.class_id, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.tenant_id = ?`
    )
    .bind(tenantId)
    .all();
  const byNo = new Map();
  const byNameClass = new Map();
  for (const st of studentRows.results) {
    if (st.student_no) byNo.set(String(st.student_no).trim(), st);
    if (st.name && st.class_name) byNameClass.set(`${String(st.name).trim()}|${String(st.class_name).trim()}`, st);
  }

  const stmts = [];
  let created = 0;
  let updated = 0;
  let failed = 0;
  const unmatched = [];
  const ts = now();

  for (const row of body.rows) {
    const student = matchStudent(row, byNo, byNameClass);
    if (!student) {
      unmatched.push(row);
      continue;
    }
    const score = Number(row.score);
    if (!Number.isFinite(score)) {
      failed++;
      continue;
    }

    if (type === 'scores') {
      const existing = await db
        .prepare('SELECT id FROM exam_scores WHERE exam_id = ? AND student_id = ?')
        .bind(exam.id, student.id)
        .first();
      if (existing) {
        stmts.push(
          db
            .prepare('UPDATE exam_scores SET score = ?, created_at = ? WHERE id = ?')
            .bind(score, ts, existing.id)
        );
        updated++;
      } else {
        stmts.push(
          db
            .prepare(
              `INSERT INTO exam_scores (id, tenant_id, exam_id, student_id, score, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(newId(), tenantId, exam.id, student.id, score, ts)
        );
        created++;
      }
    } else {
      const questionType = String(row.questionType ?? '').trim();
      const maxScore = Number(row.maxScore);
      if (!questionType || !Number.isFinite(maxScore)) {
        failed++;
        continue;
      }
      const existing = await db
        .prepare(
          'SELECT id FROM exam_subscores WHERE exam_id = ? AND student_id = ? AND question_type = ?'
        )
        .bind(exam.id, student.id, questionType)
        .first();
      if (existing) {
        stmts.push(
          db
            .prepare('UPDATE exam_subscores SET score = ?, max_score = ?, created_at = ? WHERE id = ?')
            .bind(score, maxScore, ts, existing.id)
        );
        updated++;
      } else {
        stmts.push(
          db
            .prepare(
              `INSERT INTO exam_subscores (id, tenant_id, exam_id, student_id, question_type, score, max_score, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(newId(), tenantId, exam.id, student.id, questionType, score, maxScore, ts)
        );
        created++;
      }
    }
  }

  if (stmts.length > 0) await db.batch(stmts);
  await audit(db, tenantId, user.id, `import_exam_${type}`, '考试', exam.id, {
    name: exam.name,
    created,
    updated,
    failed,
    unmatched: unmatched.length,
  });
  return c.json({ success: true, data: { created, updated, failed, unmatched } });
});

/** 分数段定义（左闭右开，最后段含 100） */
const SCORE_BANDS = [
  { label: '60以下', min: -Infinity, max: 60 },
  { label: '60-69', min: 60, max: 70 },
  { label: '70-79', min: 70, max: 80 },
  { label: '80-89', min: 80, max: 90 },
  { label: '90及以上', min: 90, max: Infinity },
];

/** 计算班内排名（同分同名次，竞赛排名法） */
function rankInClass(list) {
  let prevScore = null;
  let prevRank = 0;
  return list.map((item, idx) => {
    const rank = item.score === prevScore ? prevRank : idx + 1;
    prevScore = item.score;
    prevRank = rank;
    return { ...item, rank };
  });
}

/**
 * GET /api/v1/exams/:id/analysis — 成绩分析
 * 返回：参考人数/均分/最高/最低/分数段分布、分班均分对比、各题型均分与得分率、班内排名
 */
app.get('/:id/analysis', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const exam = await getExam(db, tenantId, c.req.param('id'));

  const scoresRes = await listScoresStmt(db, tenantId, exam.id).all();
  const scores = scoresRes.results;
  const valid = scores.filter((s) => s.score !== null && s.score !== undefined);

  // 总分概览 + 分数段分布
  const nums = valid.map((s) => s.score);
  const overview = {
    participants: valid.length,
    avg: nums.length ? round2(nums.reduce((a, b) => a + b, 0) / nums.length) : null,
    max: nums.length ? Math.max(...nums) : null,
    min: nums.length ? Math.min(...nums) : null,
    bands: SCORE_BANDS.map((b) => ({
      label: b.label,
      count: nums.filter((n) => n >= b.min && n < b.max).length,
    })),
  };

  // 分班均分对比
  const classMap = new Map();
  for (const s of valid) {
    const key = s.class_id || '(无班级)';
    if (!classMap.has(key)) classMap.set(key, { classId: s.class_id, className: s.class_name || '(无班级)', scores: [] });
    classMap.get(key).scores.push(s.score);
  }
  const classCompare = [...classMap.values()]
    .map((g) => ({
      classId: g.classId,
      className: g.className,
      count: g.scores.length,
      avg: round2(g.scores.reduce((a, b) => a + b, 0) / g.scores.length),
    }))
    .sort((a, b) => a.className.localeCompare(b.className, 'zh-Hans-CN'));

  // 各题型均分与得分率（得分率 = Σscore / Σmax_score）
  const subRes = await db
    .prepare(
      `SELECT question_type, COUNT(*) AS count,
              AVG(score) AS avg_score,
              SUM(score) AS sum_score, SUM(max_score) AS sum_max
       FROM exam_subscores
       WHERE tenant_id = ? AND exam_id = ?
       GROUP BY question_type
       ORDER BY question_type`
    )
    .bind(tenantId, exam.id)
    .all();
  const questionTypes = subRes.results.map((r) => ({
    questionType: r.question_type,
    count: r.count,
    avg: round2(r.avg_score),
    rate: r.sum_max ? round2(r.sum_score / r.sum_max) : null,
  }));

  // 班内排名（按班级分组，分数降序）
  const byClass = new Map();
  for (const s of valid) {
    const key = s.class_id || '(无班级)';
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(s);
  }
  const rankings = [...byClass.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const g = classMap.get(key);
    return {
      classId: g?.classId ?? null,
      className: g?.className ?? '(无班级)',
      list: rankInClass(sorted).map((s) => ({
        studentId: s.student_id,
        studentNo: s.student_no,
        studentName: s.student_name,
        score: s.score,
        rank: s.rank,
      })),
    };
  });

  return c.json({
    success: true,
    data: { exam, overview, classCompare, questionTypes, rankings },
  });
});

/**
 * GET /api/v1/exams/:id/students/:studentId — 学生个性化成绩报告
 * 返回：总分、班级排名、超过全班百分比、各题型得分 vs 班均（柱状图数据）、薄弱题型、建议
 */
app.get('/:id/students/:studentId', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const exam = await getExam(db, tenantId, c.req.param('id'));
  const studentId = c.req.param('studentId');

  // 校验学生归属 tenant
  const student = await db
    .prepare(
      `SELECT s.id, s.name, s.student_no, s.class_id, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.tenant_id = ? AND s.id = ?`
    )
    .bind(tenantId, studentId)
    .first();
  if (!student) throw new ApiError('NOT_FOUND', '学生不存在');

  const scoresRes = await listScoresStmt(db, tenantId, exam.id).all();
  const scores = scoresRes.results;
  const mine = scores.find((s) => s.student_id === studentId);

  // 班级排名 + 超过全班百分比（严格低于本人成绩的人数占比）
  const classmates = scores.filter(
    (s) => (s.class_id || null) === (student.class_id || null) && s.score !== null && s.score !== undefined
  );
  let classRank = null;
  let exceedPercent = null;
  if (mine && mine.score !== null && mine.score !== undefined) {
    const sorted = [...classmates].sort((a, b) => b.score - a.score);
    classRank = rankInClass(sorted).find((s) => s.student_id === studentId)?.rank ?? null;
    const lower = classmates.filter((s) => s.score < mine.score).length;
    exceedPercent = classmates.length ? round2((lower / classmates.length) * 100) : null;
  }

  // 各题型：本人得分 vs 班均（柱状图数据）；一次取全考小分后在内存中按班级聚合
  const subRes = await db
    .prepare(
      `SELECT ss.question_type, ss.student_id, ss.score, ss.max_score, st.class_id
       FROM exam_subscores ss JOIN students st ON st.id = ss.student_id
       WHERE ss.tenant_id = ? AND ss.exam_id = ?`
    )
    .bind(tenantId, exam.id)
    .all();
  const mineRows = subRes.results.filter((r) => r.student_id === studentId);
  const typeSet = new Set(mineRows.map((r) => r.question_type));
  const chartData = [];
  const weakTypes = [];
  for (const qt of [...typeSet].sort()) {
    const mineRow = mineRows.find((r) => r.question_type === qt);
    const classRowsOfType = subRes.results.filter(
      (r) => r.question_type === qt && (r.class_id || null) === (student.class_id || null)
    );
    const classAvg = classRowsOfType.length
      ? round2(classRowsOfType.reduce((a, r) => a + r.score, 0) / classRowsOfType.length)
      : null;
    const rate =
      mineRow.max_score ? round2(mineRow.score / mineRow.max_score) : null;
    chartData.push({
      questionType: qt,
      studentScore: mineRow.score,
      maxScore: mineRow.max_score,
      classAvg,
    });
    if (rate !== null && rate < 0.6) {
      weakTypes.push({
        questionType: qt,
        score: mineRow.score,
        maxScore: mineRow.max_score,
        rate: round2(rate * 100),
        classAvg,
      });
    }
  }

  // 针对性建议
  const suggestions = [];
  if (weakTypes.length === 0) {
    suggestions.push('本次考试各题型得分率均在 60% 以上，知识体系较为扎实，建议保持现有学习节奏并适当拔高。');
  } else {
    for (const w of weakTypes) {
      suggestions.push(
        `「${w.questionType}」题型得分率 ${w.rate}%（得分 ${w.score}/${w.maxScore}，班均 ${w.classAvg ?? '—'}），低于 60%，建议针对该题型进行专项练习并整理错题。`
      );
    }
    suggestions.push('建议将薄弱题型的错题按考点归类，每周安排一次限时专项训练，并及时复习巩固。');
  }

  return c.json({
    success: true,
    data: {
      exam: { id: exam.id, name: exam.name, subject: exam.subject, exam_date: exam.exam_date },
      student: {
        id: student.id,
        name: student.name,
        studentNo: student.student_no,
        classId: student.class_id,
        className: student.class_name,
      },
      totalScore: mine ? mine.score : null,
      classRank,
      exceedPercent,
      chartData,
      weakTypes,
      suggestions,
    },
  });
});

export default app;
