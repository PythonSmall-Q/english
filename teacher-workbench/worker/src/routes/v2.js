import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, canManageClass, assertCurrentYear, audit } from '../middleware.js';
import { ApiError, currentAcademicYear, resolveAcademicYear, newId, now } from '../db.js';
import { sha256Hex } from '../auth-core.js';

const app = new Hono();

function responseMeta(c, academicYear, dataVersion = 'v2-context-1') {
  return {
    request_id: c.get('requestId') || crypto.randomUUID(),
    academic_year: academicYear,
    data_version: dataVersion,
  };
}

function countValue(row) {
  return Number(row?.count || 0);
}

async function getReceipt(db, tenantId, clientMutationId) {
  if (!clientMutationId) return null;
  const row = await db.prepare(
    'SELECT result_json FROM v2_command_receipts WHERE tenant_id = ? AND client_mutation_id = ?'
  ).bind(tenantId, clientMutationId).first();
  if (!row) return null;
  try { return JSON.parse(row.result_json); } catch { return null; }
}

async function saveReceipt(db, tenantId, userId, command, result) {
  if (!command.client_mutation_id) return;
  await db.prepare(
    `INSERT INTO v2_command_receipts
      (id, tenant_id, user_id, client_mutation_id, command_type, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId(), tenantId, userId, command.client_mutation_id, command.type, JSON.stringify(result), now()).run();
}

async function getDictation(db, tenantId, id) {
  const row = await db.prepare('SELECT * FROM dictations WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!row) throw new ApiError('NOT_FOUND', '默写不存在');
  return row;
}

async function authorizeDictationWrite(db, tenantId, user, dictation) {
  await assertCurrentYear(db, tenantId, 'dictations', dictation.id);
  if (dictation.scope === 'grade') {
    const membership = await db.prepare(
      "SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'"
    ).bind(tenantId, user.id).first();
    if (!membership || !['owner', 'admin'].includes(membership.role)) throw new ApiError('FORBIDDEN', '没有全年段默写写入权限');
    return;
  }
  const managed = await canManageClass(db, tenantId, user.id, dictation.class_id);
  if (!managed.ok) throw new ApiError('FORBIDDEN', managed.reason);
}

async function executeCommand(c, command) {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const receipt = await getReceipt(db, tenantId, command.client_mutation_id);
  if (receipt) return { ...receipt, replayed: true };
  const payload = command.payload || {};
  if (command.type === 'record_dictation_results') {
    const dictation = await getDictation(db, tenantId, command.target?.id || command.target_id);
    await authorizeDictationWrite(db, tenantId, user, dictation);
    const passed = [...new Set((payload.passed || []).map(String))];
    const failed = [...new Set((payload.failed || []).map(String))];
    const allIds = [...new Set([...passed, ...failed])];
    if (!allIds.length) throw new ApiError('VALIDATION_ERROR', '结果名单为空');
    const placeholders = allIds.map(() => '?').join(',');
    const students = await db.prepare(
      dictation.scope === 'class'
        ? `SELECT id FROM students WHERE tenant_id = ? AND class_id = ? AND id IN (${placeholders})`
        : `SELECT id FROM students WHERE tenant_id = ? AND id IN (${placeholders})`
    ).bind(...(dictation.scope === 'class' ? [tenantId, dictation.class_id] : [tenantId]), ...allIds).all();
    if (students.results.length !== allIds.length) throw new ApiError('VALIDATION_ERROR', '存在无效学生');
    const timestamp = now();
    const statements = [];
    passed.forEach((studentId) => statements.push(db.prepare(
      `INSERT INTO dictation_results (id, tenant_id, dictation_id, student_id, passed, retest_required, retest_completed, created_at)
       VALUES (?, ?, ?, ?, 1, 0, 0, ?) ON CONFLICT(dictation_id, student_id)
       DO UPDATE SET passed = 1, retest_required = 0`
    ).bind(newId(), tenantId, dictation.id, studentId, timestamp)));
    failed.forEach((studentId) => statements.push(db.prepare(
      `INSERT INTO dictation_results (id, tenant_id, dictation_id, student_id, passed, retest_required, retest_completed, created_at)
       VALUES (?, ?, ?, ?, 0, 1, 0, ?) ON CONFLICT(dictation_id, student_id)
       DO UPDATE SET passed = 0, retest_required = 1`
    ).bind(newId(), tenantId, dictation.id, studentId, timestamp)));
    await db.batch(statements);
    const result = { type: command.type, target_id: dictation.id, passed: passed.length, failed: failed.length };
    await audit(db, tenantId, user.id, 'v2批量登记默写', 'dictation', dictation.id, result);
    await saveReceipt(db, tenantId, user.id, command, result);
    return result;
  }
  if (command.type === 'mark_retest_completed') {
    const dictation = await getDictation(db, tenantId, command.target?.id || command.target_id);
    await authorizeDictationWrite(db, tenantId, user, dictation);
    const studentIds = [...new Set((payload.student_ids || []).map(String))];
    if (!studentIds.length) throw new ApiError('VALIDATION_ERROR', 'student_ids 不能为空');
    const statements = studentIds.map((studentId) => db.prepare(
      `UPDATE dictation_results SET retest_completed = 1, retest_required = 0
       WHERE tenant_id = ? AND dictation_id = ? AND student_id = ?`
    ).bind(tenantId, dictation.id, studentId));
    const changes = await db.batch(statements);
    const updated = changes.filter((item) => item.meta?.changes > 0).length;
    const result = { type: command.type, target_id: dictation.id, updated };
    await audit(db, tenantId, user.id, 'v2标记重默完成', 'dictation', dictation.id, result);
    await saveReceipt(db, tenantId, user.id, command, result);
    return result;
  }
  throw new ApiError('VALIDATION_ERROR', `不支持的 v2 command：${command.type || 'unknown'}`);
}

app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
});

app.post('/commands', requireAuth, requireTenant, requireRole(['teacher', 'admin', 'owner']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const commands = Array.isArray(body.commands) ? body.commands.slice(0, 50) : [];
  if (!commands.length) throw new ApiError('VALIDATION_ERROR', 'commands 不能为空');
  const results = [];
  for (const command of commands) results.push(await executeCommand(c, command));
  return c.json({ success: true, data: { results }, meta: responseMeta(c, resolveAcademicYear(c.req.query('academic_year')), 'v2-command-1') });
});

app.post('/mcp/token', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const role = c.get('membership')?.role || 'viewer';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = `wbmcp_${btoa(binary).replace(/[^a-zA-Z0-9]/g, '')}`;
  const scopes = ['workspace:read', 'teaching:read'];
  if (['teacher', 'admin', 'owner'].includes(role)) scopes.push('teaching:write');
  if (['admin', 'owner'].includes(role)) scopes.push('students:write');
  await c.env.DB.prepare(
    `INSERT INTO mcp_tokens (id, tenant_id, user_id, token_hash, label, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId(), tenantId, user.id, await sha256Hex(token), '个人 MCP 连接', scopes.join(','), null, now()).run();
  return c.json({ success: true, data: { token, expires_at: null, scopes } }, 201);
});

app.get('/mcp/tokens', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, label, scopes, expires_at, revoked_at, created_at
       FROM mcp_tokens WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC`
  ).bind(c.get('tenantId'), c.get('user').id).all();
  return c.json({ success: true, data: { tokens: rows.results } });
});

app.post('/mcp/tokens/:id/revoke', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const result = await c.env.DB.prepare(
    'UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND user_id = ? AND revoked_at IS NULL'
  ).bind(now(), c.req.param('id'), c.get('tenantId'), c.get('user').id).run();
  return c.json({ success: true, data: { revoked: (result.meta?.changes || 0) > 0 } });
});

app.get('/context', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const user = c.get('user');
  const membership = c.get('membership');
  const tenant = c.get('tenant');

  const [classesResult, studentCount, todaySchedules, pendingLessons, assignments, dictations] = await Promise.all([
    db.prepare(
      `SELECT c.id, c.name, c.grade, c.academic_year, c.teacher_id,
              (SELECT COUNT(*) FROM students s WHERE s.tenant_id = c.tenant_id AND s.class_id = c.id AND s.exempt = 0) AS student_count
       FROM classes c
       WHERE c.tenant_id = ? AND c.academic_year = ?
       ORDER BY c.name ASC`
    ).bind(tenantId, academicYear).all(),
    db.prepare(
      'SELECT COUNT(*) AS count FROM students WHERE tenant_id = ? AND academic_year = ? AND exempt = 0'
    ).bind(tenantId, academicYear).first(),
    db.prepare(
      `SELECT s.id, s.title, s.weekday, s.period, s.start_time, s.end_time, s.classroom AS room, c.name AS class_name
       FROM schedules s LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.tenant_id = ? AND s.academic_year = ? AND s.weekday = ?
       ORDER BY s.period IS NULL, s.period ASC, s.start_time ASC LIMIT 30`
    ).bind(tenantId, academicYear, (() => { const day = new Date().getDay(); return day === 0 ? 7 : day; })()).all(),
    db.prepare(
      `SELECT l.id, l.title, l.lesson_type, l.status, l.class_id, c.name AS class_name
       FROM lessons l LEFT JOIN classes c ON c.id = l.class_id
       WHERE l.tenant_id = ? AND l.status = 'pending'
       ORDER BY l.created_at DESC LIMIT 10`
    ).bind(tenantId).all(),
    db.prepare(
      `SELECT a.id, a.title, a.deadline, a.class_id, c.name AS class_name, a.status
       FROM assignments a LEFT JOIN classes c ON c.id = a.class_id
       WHERE a.tenant_id = ? AND a.academic_year = ?
       ORDER BY a.created_at DESC LIMIT 10`
    ).bind(tenantId, academicYear).all(),
    db.prepare(
      `SELECT d.id, d.title, d.dictation_date, d.class_id, d.scope, c.name AS class_name
       FROM dictations d LEFT JOIN classes c ON c.id = d.class_id
       WHERE d.tenant_id = ? AND d.academic_year = ?
       ORDER BY d.dictation_date DESC, d.created_at DESC LIMIT 10`
    ).bind(tenantId, academicYear).all(),
  ]);

  return c.json({
    success: true,
    data: {
      user: { id: user.id, display_name: user.display_name, email: user.email },
      tenant: { id: tenant.id, name: tenant.name, role: membership.role, read_only: !!c.get('tenantReadOnly') },
      academic_year: academicYear,
      permissions: { role: membership.role },
      summary: {
        classes: classesResult.results.length,
        students: countValue(studentCount),
        pending_lessons: pendingLessons.results.length,
        recent_assignments: assignments.results.length,
        recent_dictations: dictations.results.length,
      },
      classes: classesResult.results,
      today_schedules: todaySchedules.results,
      pending_lessons: pendingLessons.results,
      recent_assignments: assignments.results,
      recent_dictations: dictations.results,
    },
    meta: responseMeta(c, academicYear),
  });
});

app.get('/classes/:id/workspace', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const classId = c.req.param('id');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const cls = await db.prepare(
    `SELECT c.id, c.name, c.grade, c.academic_year, c.teacher_id,
            (SELECT COUNT(*) FROM students s WHERE s.tenant_id = c.tenant_id AND s.class_id = c.id AND s.exempt = 0) AS student_count
       FROM classes c WHERE c.id = ? AND c.tenant_id = ? AND c.academic_year = ?`
  ).bind(classId, tenantId, academicYear).first();
  if (!cls) return c.json({ success: false, error: { code: 'NOT_FOUND', message: '班级不存在' }, request_id: c.get('requestId') }, 404);
  const [students, assignments, dictations, exams] = await Promise.all([
    db.prepare(
      `SELECT id, student_no, name, gender, status, notes FROM students
       WHERE tenant_id = ? AND class_id = ? AND academic_year = ? AND exempt = 0
       ORDER BY student_no, created_at LIMIT 200`
    ).bind(tenantId, classId, academicYear).all(),
    db.prepare(
      `SELECT id, title, deadline, status FROM assignments
       WHERE tenant_id = ? AND class_id = ? AND academic_year = ?
       ORDER BY created_at DESC LIMIT 10`
    ).bind(tenantId, classId, academicYear).all(),
    db.prepare(
      `SELECT id, title, dictation_date, scope FROM dictations
       WHERE tenant_id = ? AND academic_year = ? AND (scope = 'grade' OR class_id = ?)
       ORDER BY dictation_date DESC, created_at DESC LIMIT 10`
    ).bind(tenantId, academicYear, classId).all(),
    db.prepare(
      `SELECT e.id, e.name, e.exam_date, e.total_score,
          (SELECT AVG(es.score) FROM exam_scores es WHERE es.exam_id = e.id AND es.tenant_id = e.tenant_id) AS avg_score
         FROM exams e
       WHERE tenant_id = ? AND academic_year = ? AND (scope = 'grade' OR class_id = ?)
       ORDER BY exam_date DESC, created_at DESC LIMIT 10`
    ).bind(tenantId, academicYear, classId).all(),
  ]);
  return c.json({
    success: true,
    data: { class: cls, students: students.results, assignments: assignments.results, dictations: dictations.results, exams: exams.results },
    meta: responseMeta(c, academicYear, 'v2-class-workspace-1'),
  });
});

app.get('/students', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const classId = (c.req.query('class_id') || '').trim();
  const query = (c.req.query('q') || '').trim();
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 200);
  const params = [tenantId, academicYear];
  let sql = `SELECT s.id, s.class_id, s.student_no, s.name, s.gender, s.status, s.notes, c.name AS class_name
               FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
              WHERE s.tenant_id = ? AND s.academic_year = ? AND s.exempt = 0`;
  if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
  if (query) { sql += ' AND (s.student_no LIKE ? OR s.name LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }
  sql += ` ORDER BY s.class_id, s.student_no, s.created_at LIMIT ${limit}`;
  const rows = await db.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: { students: rows.results }, meta: responseMeta(c, academicYear, 'v2-students-1') });
});

app.get('/students/:id/workspace', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const studentId = c.req.param('id');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const student = await db.prepare(
    `SELECT s.id, s.class_id, s.student_no, s.name, s.gender, s.status, s.notes, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
      WHERE s.id = ? AND s.tenant_id = ? AND s.academic_year = ?`
  ).bind(studentId, tenantId, academicYear).first();
  if (!student) return c.json({ success: false, error: { code: 'NOT_FOUND', message: '学生不存在' }, request_id: c.get('requestId') }, 404);
  const [assignments, dictations, exams] = await Promise.all([
    db.prepare(
      `SELECT a.id, a.title, a.deadline, s.status FROM assignment_submissions s
       JOIN assignments a ON a.id = s.assignment_id AND a.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND s.student_id = ? AND a.academic_year = ?
      ORDER BY a.created_at DESC LIMIT 20`
    ).bind(tenantId, studentId, academicYear).all(),
    db.prepare(
      `SELECT r.dictation_id, d.title, r.passed, r.retest_required, r.retest_completed
       FROM dictation_results r JOIN dictations d ON d.id = r.dictation_id AND d.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.student_id = ? AND d.academic_year = ?
      ORDER BY d.dictation_date DESC, d.created_at DESC LIMIT 20`
    ).bind(tenantId, studentId, academicYear).all(),
    db.prepare(
      `SELECT e.id, e.name, e.exam_date, s.score, e.total_score
       FROM exam_scores s JOIN exams e ON e.id = s.exam_id AND e.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND s.student_id = ? AND e.academic_year = ?
      ORDER BY e.exam_date DESC, e.created_at DESC LIMIT 20`
    ).bind(tenantId, studentId, academicYear).all(),
  ]);
  return c.json({
    success: true,
    data: { student, assignments: assignments.results, dictations: dictations.results, exams: exams.results },
    meta: responseMeta(c, academicYear, 'v2-student-workspace-1'),
  });
});

app.get('/dictations', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const rows = await db.prepare(
    `SELECT d.id, d.title, d.dictation_date, d.scope, d.class_id, c.name AS class_name,
            COUNT(r.student_id) AS registered,
            SUM(CASE WHEN r.passed = 1 THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN r.passed = 0 THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN r.retest_required = 1 AND r.retest_completed = 0 THEN 1 ELSE 0 END) AS retest_required,
            SUM(CASE WHEN r.retest_completed = 1 THEN 1 ELSE 0 END) AS retest_completed
       FROM dictations d LEFT JOIN dictation_results r ON r.dictation_id = d.id AND r.tenant_id = d.tenant_id
       LEFT JOIN classes c ON c.id = d.class_id AND c.tenant_id = d.tenant_id
      WHERE d.tenant_id = ? AND d.academic_year = ?
      GROUP BY d.id, d.title, d.dictation_date, d.scope, d.class_id, c.name
      ORDER BY d.dictation_date DESC, d.created_at DESC LIMIT 100`
  ).bind(tenantId, academicYear).all();
  return c.json({ success: true, data: { dictations: rows.results }, meta: responseMeta(c, academicYear, 'v2-dictations-1') });
});

app.get('/assignments', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const rows = await db.prepare(
    `SELECT a.id, a.title, a.deadline, a.status, a.class_id, c.name AS class_name,
            COUNT(s.student_id) AS submitted_count,
            SUM(CASE WHEN s.status = 'missing' THEN 1 ELSE 0 END) AS missing_count
       FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.tenant_id = a.tenant_id
       LEFT JOIN classes c ON c.id = a.class_id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.academic_year = ?
      GROUP BY a.id, a.title, a.deadline, a.status, a.class_id, c.name
      ORDER BY a.created_at DESC LIMIT 100`
  ).bind(tenantId, academicYear).all();
  return c.json({ success: true, data: { assignments: rows.results }, meta: responseMeta(c, academicYear, 'v2-assignments-1') });
});

app.get('/exams', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const rows = await db.prepare(
    `SELECT e.id, e.name, e.subject, e.exam_date, e.total_score, e.scope, e.class_id, c.name AS class_name,
            COUNT(s.student_id) AS student_count,
            AVG(s.score) AS avg_score
       FROM exams e LEFT JOIN exam_scores s ON s.exam_id = e.id AND s.tenant_id = e.tenant_id
       LEFT JOIN classes c ON c.id = e.class_id AND c.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.academic_year = ?
      GROUP BY e.id, e.name, e.subject, e.exam_date, e.total_score, e.scope, e.class_id, c.name
      ORDER BY e.exam_date DESC, e.created_at DESC LIMIT 100`
  ).bind(tenantId, academicYear).all();
  return c.json({ success: true, data: { exams: rows.results }, meta: responseMeta(c, academicYear, 'v2-exams-1') });
});

app.get('/schedules', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const rows = await db.prepare(
    `SELECT s.id, s.title, s.weekday, s.period, s.start_time, s.end_time, s.classroom AS room, s.class_id, c.name AS class_name
       FROM schedules s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND s.academic_year = ?
      ORDER BY s.weekday, s.period IS NULL, s.period, s.start_time LIMIT 300`
  ).bind(tenantId, academicYear).all();
  return c.json({ success: true, data: { schedules: rows.results }, meta: responseMeta(c, academicYear, 'v2-schedules-1') });
});

app.get('/lessons', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const academicYear = resolveAcademicYear(c.req.query('academic_year') || currentAcademicYear());
  const rows = await db.prepare(
    `SELECT l.id, l.title, l.lesson_type, l.status, l.class_id, l.updated_at, c.name AS class_name
       FROM lessons l LEFT JOIN classes c ON c.id = l.class_id AND c.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND (l.academic_year = ? OR l.academic_year IS NULL)
      ORDER BY l.updated_at DESC LIMIT 100`
  ).bind(tenantId, academicYear).all();
  return c.json({ success: true, data: { lessons: rows.results }, meta: responseMeta(c, academicYear, 'v2-lessons-1') });
});

app.get('/todos', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const rows = await db.prepare(
    `SELECT id, title, scope, group_id, due_date, status, created_at, updated_at
       FROM todos WHERE tenant_id = ? ORDER BY status = 'done', due_date IS NULL, due_date, updated_at DESC LIMIT 200`
  ).bind(tenantId).all();
  return c.json({ success: true, data: { todos: rows.results }, meta: responseMeta(c, currentAcademicYear(), 'v2-todos-1') });
});

app.get('/recycle', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const rows = await db.prepare(
    `SELECT id, item_type, item_id, title, deleted_by, deleted_at
       FROM recycle_bin WHERE tenant_id = ? ORDER BY deleted_at DESC LIMIT 200`
  ).bind(tenantId).all();
  return c.json({ success: true, data: { items: rows.results }, meta: responseMeta(c, currentAcademicYear(), 'v2-recycle-1') });
});

export default app;
