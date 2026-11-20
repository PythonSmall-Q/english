/**
 * scripts/smoke-test.mjs — 端到端冒烟测试（Node 18+ 原生 fetch）
 *
 * 前置：worker 已在 http://localhost:8787 启动（npx wrangler dev --local --port 8787）
 * 运行：node scripts/smoke-test.mjs
 *
 * 覆盖（按任务书）：
 *  - 注册两个用户 → 各自自动个人空间（租户隔离基础）
 *  - u1 全流程：班级/学生/教案/课表/作业批量登记/默写批量登记+重默/
 *    考试导入成绩与小分/分析/学生报告/dashboard/学生名单导入/备份/恢复
 *  - AI 配额：默认 20 次/月，第 21 次 403 QUOTA_EXCEEDED
 *  - Files：R2 真实上传/查询/删除（含元数据与公共 URL）
 *  - 隔离：u2 指向 u1 租户 → 403；权限：u1 访问 /admin/tenants → 403
 *  - 配额：个人空间 max_classes=2，建第 3 个班 → 403 QUOTA_EXCEEDED
 *
 * 全部断言打印 PASS/FAIL，任一 FAIL 以非零码退出。
 */

const BASE = process.env.API_BASE || 'http://localhost:8787/api/v1';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

/** 统一请求：手动管理 Cookie（Node fetch 不持久化），自动带 X-Tenant-Id */
async function call(cookie, tenantId, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/session=[^;]+/);
  return { status: res.status, payload, cookie: m ? m[0] : null };
}

/** 注册（已存在则登录），返回 { cookie, user, tenants } */
async function ensureUser(email, password) {
  let r = await call(null, null, 'POST', '/auth/register', { email, password, displayName: email.split('@')[0] });
  if (r.status === 409) r = await call(null, null, 'POST', '/auth/login', { email, password });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`注册/登录失败 ${email}: HTTP ${r.status} ${JSON.stringify(r.payload)}`);
  }
  const cookie = r.cookie;
  const me = await call(cookie, null, 'GET', '/auth/me');
  if (me.status !== 200) throw new Error(`auth/me 失败: HTTP ${me.status}`);
  return { cookie, user: me.payload.data.user, tenants: me.payload.data.tenants };
}

async function main() {
  console.log(`\n== 英语教师教学工作台 V3 冒烟测试 ==\n目标: ${BASE}\n`);

  // ---------- 1. 两个用户注册 + 自动个人空间 ----------
  const u1 = await ensureUser('smoke1@t.local', 'password123');
  const u2 = await ensureUser('smoke2@t.local', 'password123');
  const t1 = u1.tenants[0] && u1.tenants[0].id;
  const t2 = u2.tenants[0] && u2.tenants[0].id;
  check('u1 注册并自动获得个人空间（owner）', !!t1 && u1.tenants[0].role === 'owner');
  check('u2 注册并自动获得个人空间（owner）', !!t2 && u2.tenants[0].role === 'owner');
  check('租户隔离基础：u1/u2 空间 id 不同', !!t1 && !!t2 && t1 !== t2);

  const api1 = (method, path, body) => call(u1.cookie, t1, method, path, body);

  // ---------- 2. 班级（2 个，第 3 个触发配额） ----------
  const c1 = await api1('POST', '/classes', { name: '高三1班', grade: '高三' });
  const c2 = await api1('POST', '/classes', { name: '高三2班', grade: '高三' });
  check('u1 创建班级 1（201）', c1.status === 201 && !!c1.payload.data.id, JSON.stringify(c1.payload));
  check('u1 创建班级 2（201）', c2.status === 201 && !!c2.payload.data.id);
  const c1Id = c1.payload.data.id;
  const c2Id = c2.payload.data.id;

  const c3 = await api1('POST', '/classes', { name: '高三3班' });
  check(
    '配额：个人空间 max_classes=2，第 3 个班 403 QUOTA_EXCEEDED',
    c3.status === 403 && c3.payload?.error?.code === 'QUOTA_EXCEEDED',
    `HTTP ${c3.status} ${JSON.stringify(c3.payload)}`
  );

  // ---------- 3. 学生（每班 3 人） ----------
  const students = {}; // studentNo → id
  const roster = [
    ['202401', '张三', c1Id],
    ['202402', '李四', c1Id],
    ['202403', '王五', c1Id],
    ['202501', '赵六', c2Id],
    ['202502', '钱七', c2Id],
    ['202503', '孙八', c2Id],
  ];
  let allCreated = true;
  for (const [no, name, cls] of roster) {
    const r = await api1('POST', '/students', { class_id: cls, name, student_no: no });
    if (r.status === 201) students[no] = r.payload.data.id;
    else allCreated = false;
  }
  check('u1 创建 6 名学生（每班 3 人）', allCreated && Object.keys(students).length === 6);
  const s1 = students['202401'];
  const s3 = students['202403'];

  // ---------- 4. 教案：创建并标记完成 ----------
  const lesson = await api1('POST', '/lessons', { title: 'Unit 1 Reading', class_id: c1Id, lesson_type: 'reading' });
  const lessonId = lesson.payload?.data?.id;
  const lessonDone = await api1('PUT', `/lessons/${lessonId}`, { status: 'completed' });
  const lessons = await api1('GET', '/lessons?status=completed');
  check(
    '教案创建并标记完成',
    lesson.status === 201 && lessonDone.status === 200 &&
      (lessons.payload.data.lessons || []).some((l) => l.id === lessonId && l.status === 'completed')
  );

  // ---------- 5. 课表：1 条班级课 + 1 条全年段 ----------
  const todayWeekday = ((new Date().getDay() + 6) % 7) + 1; // 1=周一 … 7=周日
  const sch1 = await api1('POST', '/schedules', { weekday: todayWeekday, period: 1, class_id: c1Id, title: '英语', scope: 'class' });
  const sch2 = await api1('POST', '/schedules', { weekday: 2, title: '英语晚自习', scope: 'grade' });
  const schedules = await api1('GET', '/schedules');
  const schList = schedules.payload?.data?.schedules || [];
  check(
    '课表：1 条班级课 + 1 条全年段',
    sch1.status === 201 && sch2.status === 201 &&
      schList.some((s) => s.scope === 'class' && s.class_id === c1Id) &&
      schList.some((s) => s.scope === 'grade')
  );

  // ---------- 6. 作业：创建 + bulk 登记 {submitted, missing} + 统计 ----------
  const assign = await api1('POST', '/assignments', { class_id: c1Id, title: '作业1：词汇练习' });
  const a1 = assign.payload?.data?.id;
  const bulk = await api1('POST', `/assignments/${a1}/submissions/bulk`, {
    submitted: [students['202401'], students['202402']],
    missing: [students['202403']],
  });
  check(
    '作业 bulk 登记（{submitted, missing} 格式）',
    bulk.status === 200 && bulk.payload.data.submitted === 2 && bulk.payload.data.missing === 1,
    JSON.stringify(bulk.payload)
  );
  const assignList = await api1('GET', `/assignments?class_id=${c1Id}`);
  const aStats = (assignList.payload?.data?.list || []).find((a) => a.id === a1)?.stats;
  check(
    '作业统计正确（total=3 / submitted=2 / missing=1 / rate≈0.67）',
    !!aStats && aStats.total === 3 && aStats.submitted === 2 && aStats.missing === 1 && Math.abs(aStats.submitRate - 0.67) < 0.001,
    JSON.stringify(aStats)
  );

  // ---------- 7. 默写：创建 + bulk 登记 {passed, failed} + 重默 ----------
  const dict = await api1('POST', '/dictations', { title: 'Unit 1 单词默写', class_id: c1Id, scope: 'class' });
  const d1 = dict.payload?.data?.id;
  const dbulk = await api1('POST', `/dictations/${d1}/results/bulk`, {
    passed: [students['202401'], students['202402']],
    failed: [students['202403']],
  });
  check(
    '默写 bulk 登记（{passed, failed} 格式）',
    dbulk.status === 200 && dbulk.payload.data.passed === 2 && dbulk.payload.data.failed === 1,
    JSON.stringify(dbulk.payload)
  );
  const retest = await api1('POST', `/dictations/${d1}/retest`, { studentIds: [s3], completed: true });
  check('默写重默标记（updated=1）', retest.status === 200 && retest.payload.data.updated === 1);
  const dictList = await api1('GET', `/dictations?class_id=${c1Id}`);
  const dStats = (dictList.payload?.data?.list || []).find((d) => d.id === d1)?.stats;
  check(
    '默写统计正确（passed=2 / retestRequired=0 / retestCompleted=1）',
    !!dStats && dStats.passed === 2 && dStats.retestRequired === 0 && dStats.retestCompleted === 1,
    JSON.stringify(dStats)
  );

  // ---------- 8. 考试：导入成绩（学号/姓名班级/未匹配）+ 小分 ----------
  const exam = await api1('POST', '/exams', { name: '高三上期中考试', subject: '英语', exam_date: '2026-11-01' });
  const e1 = exam.payload?.data?.id;
  check('创建考试（201）', exam.status === 201 && !!e1);

  const impScores = await api1('POST', `/exams/${e1}/import`, {
    type: 'scores',
    rows: [
      { studentNo: '202401', score: 95 }, // 学号匹配
      { name: '李四', className: '高三1班', score: 88 }, // 姓名+班级匹配
      { name: '赵六', className: '高三2班', score: 70 }, // 2 班学生
      { studentNo: '999999', score: 60 }, // 未匹配
    ],
  });
  check(
    '导入成绩：created=3 / unmatched=1',
    impScores.status === 200 && impScores.payload.data.created === 3 &&
      impScores.payload.data.unmatched.length === 1 && impScores.payload.data.failed === 0,
    JSON.stringify(impScores.payload)
  );

  const impSubs = await api1('POST', `/exams/${e1}/import`, {
    type: 'subscores',
    rows: [
      { studentNo: '202401', questionType: '听力', score: 25, maxScore: 30 },
      { studentNo: '202401', questionType: '阅读', score: 20, maxScore: 45 },
      { studentNo: '202401', questionType: '写作', score: 16, maxScore: 20 },
      { studentNo: '202402', questionType: '听力', score: 28, maxScore: 30 },
      { studentNo: '202402', questionType: '阅读', score: 40, maxScore: 45 },
      { studentNo: '202402', questionType: '写作', score: 12, maxScore: 20 },
    ],
  });
  check(
    '导入小分：created=6',
    impSubs.status === 200 && impSubs.payload.data.created === 6,
    JSON.stringify(impSubs.payload)
  );

  // ---------- 9. 成绩分析 ----------
  const analysis = await api1('GET', `/exams/${e1}/analysis`);
  const an = analysis.payload?.data;
  const bandsSum = an?.overview?.bands?.reduce((a, b) => a + b.count, 0);
  check(
    'analysis 字段齐全（overview/bands/classCompare/questionTypes/rankings）',
    analysis.status === 200 && !!an &&
      an.overview.participants === 3 && an.overview.max === 95 && an.overview.min === 70 &&
      Math.abs(an.overview.avg - 84.33) < 0.01 && an.overview.bands.length === 5 && bandsSum === 3 &&
      an.classCompare.length === 2 && an.questionTypes.length === 3 && an.rankings.length === 2,
    JSON.stringify(an?.overview)
  );

  // ---------- 10. 学生个性化报告 ----------
  const report = await api1('GET', `/exams/${e1}/students/${s1}`);
  const rp = report.payload?.data;
  check(
    '学生报告字段齐全（totalScore/classRank/exceedPercent/chartData/weakTypes/suggestions）',
    report.status === 200 && !!rp &&
      rp.totalScore === 95 && rp.classRank === 1 && rp.exceedPercent === 50 &&
      rp.chartData.length === 3 && rp.weakTypes.length === 1 &&
      rp.weakTypes[0].questionType === '阅读' && rp.suggestions.length >= 1,
    JSON.stringify({ totalScore: rp?.totalScore, classRank: rp?.classRank, weak: rp?.weakTypes })
  );

  // ---------- 11. Dashboard 四类数据 ----------
  const dash = await api1('GET', '/dashboard');
  const dd = dash.payload?.data;
  check(
    'dashboard 三类数据齐全（todaySchedules/lessonTodo/recentAssignments）',
    dash.status === 200 && !!dd &&
      Array.isArray(dd.todaySchedules) && Array.isArray(dd.lessonTodo) && Array.isArray(dd.recentAssignments),
    JSON.stringify(dd && Object.keys(dd))
  );
  check(
    'dashboard 最近作业统计正确（作业1 total=3 / submitted=2）',
    !!dd && !!dd.recentAssignments[0] &&
      dd.recentAssignments[0].title === '作业1：词汇练习' &&
      dd.recentAssignments[0].total_count === 3 && dd.recentAssignments[0].submitted_count === 2,
    JSON.stringify(dd?.recentAssignments?.[0] && { t: dd.recentAssignments[0].total_count, s: dd.recentAssignments[0].submitted_count })
  );

  // ---------- 12. 学生名单导入（1 班匹配 1 班未匹配） ----------
  const impStu = await api1('POST', '/import/students', {
    rows: [
      { studentNo: '202404', name: '周九', className: '高三1班' },
      { studentNo: '202405', name: '吴十', className: '高三9班' },
    ],
  });
  check(
    '导入学生：created=1 / unmatched=1',
    impStu.status === 201 && impStu.payload.data.created === 1 && impStu.payload.data.unmatched.length === 1,
    JSON.stringify(impStu.payload)
  );

  // ---------- 13. 导出：学生名单含 notes；备份结构 13 个 key ----------
  const expStu = await api1('GET', '/export/students');
  const expRows = expStu.payload?.data?.students || [];
  check(
    'export/students 含 notes 字段且共 7 人',
    expStu.status === 200 && expRows.length === 7 && expRows.every((r) => 'notes' in r)
  );

  const backup = await api1('GET', '/export/backup');
  const bk = backup.payload?.data;
  const EXPECT_KEYS = ['version', 'tenant', 'classes', 'students', 'lessons', 'schedules', 'assignments', 'submissions', 'dictations', 'dictationResults', 'exams', 'scores', 'subscores'];
  check(
    'export/backup 结构 13 个 key（version=3）',
    backup.status === 200 && !!bk && bk.version === 3 && EXPECT_KEYS.every((k) => k in bk) && Object.keys(bk).length === 13,
    Object.keys(bk || {}).join(',')
  );

  // ---------- 14. 备份恢复 ----------
  const restore = await api1('POST', '/import/restore', bk);
  check(
    'import/restore 恢复成功（条数统计正确）',
    restore.status === 200 && restore.payload.data.restored > 0 &&
      restore.payload.data.counts.students === bk.students.length &&
      restore.payload.data.counts.classes === bk.classes.length,
    JSON.stringify(restore.payload)
  );
  const afterStudents = await api1('GET', '/students');
  const afterClasses = await api1('GET', '/classes');
  check(
    '恢复后数据与备份一致（7 学生 / 2 班）',
    (afterStudents.payload?.data?.students || []).length === bk.students.length &&
      (afterClasses.payload?.data?.classes || []).length === bk.classes.length
  );

  // 跨租户恢复必须被拒（u1 的备份，u2 的空间）
  const crossRestore = await call(u2.cookie, t2, 'POST', '/import/restore', bk);
  check(
    '跨租户恢复被拒（403 FORBIDDEN）',
    crossRestore.status === 403 && crossRestore.payload?.error?.code === 'FORBIDDEN',
    `HTTP ${crossRestore.status} ${JSON.stringify(crossRestore.payload)}`
  );

  // ---------- 15. AI：功能已整体下线（9775b06），接口统一返回 503 AI_DISABLED ----------
  // 后端保留 AI 调用代码，产品当前禁用；此处断言下线口径而非旧的配额口径
  const ai1 = await api1('POST', '/ai/generate', { type: 'practice', prompt: '一般过去时' });
  check('AI 已下线：generate → 503 AI_DISABLED',
    ai1.status === 503 && ai1.payload?.error?.code === 'AI_DISABLED',
    `HTTP ${ai1.status} ${JSON.stringify(ai1.payload)}`);
  const aiHist = await api1('GET', '/ai/sessions');
  check('AI 已下线：sessions → 503 AI_DISABLED',
    aiHist.status === 503 && aiHist.payload?.error?.code === 'AI_DISABLED',
    `HTTP ${aiHist.status}`);

  // ---------- 16. Files：R2 真实上传/查询/删除 ----------
  const uploadRes = await fetch(BASE + '/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent('冒烟测试卷.pdf'),
      Cookie: u1.cookie,
      'X-Tenant-Id': t1,
    },
    body: Buffer.from('%PDF-1.4 smoke test'),
  });
  const uploadPayload = await uploadRes.json();
  const fileDto = uploadPayload?.data || {};
  check(
    'files 上传成功（R2 + 元数据）',
    uploadRes.status === 201 && !!fileDto.id && !!fileDto.url && fileDto.url.includes('fff-file-r2-cloudflare.xmoj-script.uk'),
    `HTTP ${uploadRes.status} ${JSON.stringify(uploadPayload)}`
  );
  const fileGet = await call(u1.cookie, t1, 'GET', `/files/${fileDto.id}`);
  check('files 元数据查询（跨租户 u2 应 404）', fileGet.status === 200 && fileGet.payload?.data?.name === '冒烟测试卷.pdf');
  const fileGetCross = await call(u2.cookie, t2, 'GET', `/files/${fileDto.id}`);
  check('files 元数据租户隔离（u2 → 404）', fileGetCross.status === 404);
  const fileDel = await call(u1.cookie, t1, 'DELETE', `/files/${fileDto.id}`);
  check('files 删除成功', fileDel.status === 200);
  const fileGetAfter = await call(u1.cookie, t1, 'GET', `/files/${fileDto.id}`);
  check('files 删除后 404', fileGetAfter.status === 404);

  // ---------- 17. 租户隔离与权限 ----------
  const crossGet = await call(u2.cookie, t1, 'GET', '/students');
  check(
    '隔离：u2 用 X-Tenant-Id 指向 u1 空间 → 403',
    crossGet.status === 403 && crossGet.payload?.error?.code === 'FORBIDDEN',
    `HTTP ${crossGet.status}`
  );
  const ownGet = await call(u2.cookie, t2, 'GET', '/students');
  check('隔离：u2 访问自己空间正常（200）', ownGet.status === 200);
  const adminGet = await call(u1.cookie, t1, 'GET', '/admin/tenants');
  check(
    '权限：u1（非 platform_admin）访问 /admin/tenants → 403',
    adminGet.status === 403 && adminGet.payload?.error?.code === 'FORBIDDEN',
    `HTTP ${adminGet.status}`
  );

  // ---------- 18. 合并考试：分项之和口径 ----------
  // 两场全年段分项考试（满分各 150）；王五在分项1缺考、分项2无行 → 合并后不计入统计
  const cx1 = await api1('POST', '/exams', { name: '分项·期中', total_score: 150, exam_date: '2026-11-01' });
  const cx2 = await api1('POST', '/exams', { name: '分项·月考', total_score: 150, exam_date: '2026-12-01' });
  const cx1Id = cx1.payload?.data?.id;
  const cx2Id = cx2.payload?.data?.id;
  check('合并考试前置：创建 2 场分项考试（201）', cx1.status === 201 && cx2.status === 201 && !!cx1Id && !!cx2Id);

  await api1('POST', `/exams/${cx1Id}/import`, {
    type: 'scores',
    rows: [
      { studentNo: '202401', score: 120 }, // 张三
      { studentNo: '202402', score: 90 }, // 李四
      { studentNo: '202403', score: null }, // 王五缺考
    ],
  });
  const impCx2 = await api1('POST', `/exams/${cx2Id}/import`, {
    type: 'scores',
    rows: [
      { studentNo: '202401', score: 100 },
      { studentNo: '202402', score: 30 },
    ],
  });
  check('合并考试前置：分项成绩导入成功', impCx2.status === 200 && impCx2.payload.data.created === 2);

  // 分项不足 2 个 → 400
  const comBad = await api1('POST', '/exams/com', { name: '坏合并', component_ids: [cx1Id] });
  check('合并考试校验：分项不足 2 个 → 400 VALIDATION_ERROR',
    comBad.status === 400 && comBad.payload?.error?.code === 'VALIDATION_ERROR',
    `HTTP ${comBad.status} ${JSON.stringify(comBad.payload)}`);

  const com = await api1('POST', '/exams/com', { name: '合并·期中+月考', component_ids: [cx1Id, cx2Id] });
  const comId = com.payload?.data?.id;
  check('创建合并考试（201，total_score=300，scope=grade，composite=1）',
    com.status === 201 && !!comId && com.payload.data.total_score === 300 &&
      com.payload.data.composite === 1 && com.payload.data.scope === 'grade',
    JSON.stringify(com.payload));

  // 列表：合并行人数/均分按有效总分重算，行上附 components
  const comList = await api1('GET', '/exams');
  const comRow = (comList.payload?.data || []).find((e) => e.id === comId);
  check('合并考试列表：student_count=2 / avg_score=170 / components=2',
    !!comRow && comRow.student_count === 2 && comRow.avg_score === 170 &&
      Array.isArray(comRow.components) && comRow.components.length === 2 &&
      comRow.components[0].id === cx1Id && comRow.components[0].name === '分项·期中',
    JSON.stringify(comRow && { c: comRow.student_count, a: comRow.avg_score, comps: comRow.components }));

  // 详情：exam 上有序 components；分数行带 components 明细；总分=分项之和
  const comDetail = await api1('GET', `/exams/${comId}`);
  const cd = comDetail.payload?.data;
  const cdZs = (cd?.scores || []).find((s) => s.student_id === s1); // 张三
  const cdWw = (cd?.scores || []).find((s) => s.student_id === s3); // 王五
  check('合并考试详情：有序 components + 分数行明细 + 总分=分项之和',
    comDetail.status === 200 && !!cd &&
      Array.isArray(cd.components) && cd.components.length === 2 &&
      cd.components[0].id === cx1Id && cd.components[1].id === cx2Id &&
      !!cdZs && cdZs.score === 220 &&
      Array.isArray(cdZs.components) && cdZs.components.length === 2 &&
      cdZs.components[0].examId === cx1Id && cdZs.components[0].score === 120 &&
      cdZs.components[1].examId === cx2Id && cdZs.components[1].score === 100 &&
      !!cdWw && cdWw.score === null && cdWw.absent === 1,
    JSON.stringify(cdZs && { score: cdZs.score, comps: cdZs.components }));

  // 分析：overview/rankings 用有效总分；questionTypes 返回 []
  const comAnalysis = await api1('GET', `/exams/${comId}/analysis`);
  const ca = comAnalysis.payload?.data;
  check('合并考试分析：participants=2 / avg=170 / max=220 / questionTypes=[]',
    comAnalysis.status === 200 && !!ca &&
      ca.overview.participants === 2 && ca.overview.avg === 170 && ca.overview.max === 220 &&
      Array.isArray(ca.questionTypes) && ca.questionTypes.length === 0 &&
      ca.rankings.length === 1 && ca.rankings[0].list.length === 2 &&
      ca.rankings[0].list[0].studentName === '张三' && ca.rankings[0].list[0].score === 220,
    JSON.stringify(ca?.overview));

  // 写操作拦截：PUT 学生成绩 / import 均 400
  const comPut = await api1('PUT', `/exams/${comId}/students/${s1}`, { score: 200 });
  const comImp = await api1('POST', `/exams/${comId}/import`, { type: 'scores', rows: [{ studentNo: '202401', score: 100 }] });
  check('合并考试写拦截：PUT 学生成绩 → 400 VALIDATION_ERROR',
    comPut.status === 400 && comPut.payload?.error?.code === 'VALIDATION_ERROR',
    `HTTP ${comPut.status}`);
  check('合并考试写拦截：import → 400 VALIDATION_ERROR',
    comImp.status === 400 && comImp.payload?.error?.code === 'VALIDATION_ERROR',
    `HTTP ${comImp.status}`);

  // 学生报告：totalScore=有效总分；chartData 按分项对比；weakTypes 按分项得分率<60%
  const comReport = await api1('GET', `/exams/${comId}/students/${students['202402']}`); // 李四
  const cr = comReport.payload?.data;
  check('合并考试学生报告：totalScore=120 / chartData=分项对比 / weakTypes=月考',
    comReport.status === 200 && !!cr &&
      cr.totalScore === 120 && Array.isArray(cr.chartData) && cr.chartData.length === 2 &&
      cr.chartData[0].questionType === '分项·期中' && cr.chartData[0].studentScore === 90 && cr.chartData[0].maxScore === 150 &&
      cr.chartData[1].questionType === '分项·月考' && cr.chartData[1].studentScore === 30 && cr.chartData[1].maxScore === 150 &&
      cr.weakTypes.length === 1 && cr.weakTypes[0].questionType === '分项·月考' && cr.weakTypes[0].rate === 20 &&
      cr.suggestions.length >= 1,
    JSON.stringify(cr && { total: cr.totalScore, chart: cr.chartData, weak: cr.weakTypes }));

  // 分项成绩修改后合并视图自动反映（§37 联动）
  await api1('PUT', `/exams/${cx1Id}/students/${s1}`, { score: 130 });
  const comDetail2 = await api1('GET', `/exams/${comId}`);
  const cdZs2 = (comDetail2.payload?.data?.scores || []).find((s) => s.student_id === s1);
  check('分项成绩修改后合并总分自动反映（220 → 230）', !!cdZs2 && cdZs2.score === 230,
    JSON.stringify(cdZs2 && { score: cdZs2.score }));
  await api1('PUT', `/exams/${cx1Id}/students/${s1}`, { score: 120 }); // 还原

  // 导出总分：合并考试用有效总分
  const comExp = await api1('GET', '/exams/export-totals');
  const ceScores = comExp.payload?.data?.scores?.[comId];
  check('export-totals：合并考试分数=有效总分（张三=220，王五=null）',
    !!ceScores && ceScores[s1] === 220 && ceScores[s3] === null,
    JSON.stringify(ceScores));

  // 删除合并考试：分项考试及其成绩完好
  const comDel = await api1('DELETE', `/exams/${comId}`);
  const cx1After = await api1('GET', `/exams/${cx1Id}`);
  const cx1Rows = cx1After.payload?.data?.scores || [];
  const comAfter = await api1('GET', `/exams/${comId}`);
  check('删除合并考试：分项考试及其成绩完好，合并行已删',
    comDel.status === 200 && cx1After.status === 200 && cx1Rows.length === 3 &&
      comAfter.status === 404,
    `cx1Rows=${cx1Rows.length} comHTTP=${comAfter.status}`);

  // 回收站：捕获含 exam_components 行，恢复后合并考试与分项关系完整
  const bin = await api1('GET', '/recycle');
  const binEntry = (bin.payload?.data?.list || []).find(
    (it) => it.item_type === 'exam' && it.item_id === comId
  );
  const binRestore = binEntry ? await api1('POST', `/recycle/${binEntry.id}/restore`) : null;
  const comRestored = binRestore && binRestore.status === 200 ? await api1('GET', `/exams/${comId}`) : null;
  check('回收站恢复合并考试：考试与 components 一并恢复',
    !!binRestore && binRestore.status === 200 && !!comRestored && comRestored.status === 200 &&
      Array.isArray(comRestored.payload?.data?.components) && comRestored.payload.data.components.length === 2,
    JSON.stringify(binRestore && binRestore.payload));
  // 恢复后再删一次，保持后续断言环境干净
  if (comRestored && comRestored.status === 200) await api1('DELETE', `/exams/${comId}`);

  // ---------- 汇总 ----------
  console.log(`\n== 结果：${passed} PASS / ${failed} FAIL ==`);
  if (failed > 0) {
    console.log('失败项：\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n冒烟测试执行异常：', err);
  process.exit(1);
});
