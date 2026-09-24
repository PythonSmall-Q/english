/* 增量导入端到端测试：先造目标空间（已有班级+学生），再 merge 一份有重叠的备份 */
const BASE = 'http://localhost:8787/api/v1';
const j = (r) => r.json();
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

async function main() {
  // 平台管理员注册+登录
  const email = 'pa_merge@test.com';
  await fetch(`${BASE}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password8', displayName: 'PA' }) });
  const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password8' }) });
  const cookie = cookieOf(login);

  // 建目标租户
  const t = await fetch(`${BASE}/tenants`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: '合并目标校', slug: 'merge-target', plan: 'custom' }) }).then(j);
  const tenantId = t.data.id;
  const H = { 'Content-Type': 'application/json', Cookie: cookie, 'X-Tenant-Id': tenantId };

  // 目标空间已有：高三1班（真实 id C-REAL）+ 学生 学号 S001 张三（真实 id STU-REAL）
  const newCls = await fetch(`${BASE}/classes`, { method: 'POST', headers: H, body: JSON.stringify({ name: '高三1班' }) }).then(j);
  await fetch(`${BASE}/import/students`, { method: 'POST', headers: H, body: JSON.stringify({ rows: [{ studentNo: 'S001', name: '张三', className: '高三1班', gender: '男' }] }) }).then(j);
  const classList = await fetch(`${BASE}/classes`, { headers: H }).then(j);
  const realClass = (classList.data.classes || []).find((c) => c.name === '高三1班');
  const studentsNow = await fetch(`${BASE}/students`, { headers: H }).then(j);
  const realStudent = studentsNow.data.students.find((s) => s.student_no === 'S001');

  // 备份：含 高三1班（同班同名同学年 → 应匹配）+ 高三2班（新）+ 张三(学号S001→匹配更新) + 李四(新) + 一次默写挂张三
  const backup = {
    version: 3,
    tenant: { name: 'x' },
    classes: [
      { id: 'C-OLD-1', tenant_id: 'x', name: '高三1班', academic_year: realClass.academic_year, teacher_id: 'OLD-TEACHER-1', created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' },
      { id: 'C-OLD-2', tenant_id: 'x', name: '高三2班', academic_year: realClass.academic_year, teacher_id: 'OLD-TEACHER-1', created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' },
    ],
    students: [
      { id: 'S-OLD-1', tenant_id: 'x', class_id: 'C-OLD-1', student_no: 'S001', name: '张三丰', gender: '男', status: 'normal', academic_year: realClass.academic_year, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' },
      { id: 'S-OLD-2', tenant_id: 'x', class_id: 'C-OLD-1', student_no: 'S002', name: '李四', gender: '女', status: 'normal', academic_year: realClass.academic_year, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' },
    ],
    lessons: [], schedules: [], assignments: [], submissions: [], exams: [], scores: [], subscores: [],
    dictations: [
      { id: 'D-OLD-1', tenant_id: 'x', teacher_id: 'OLD-TEACHER-1', class_id: 'C-OLD-1', title: 'VT9', scope: 'class', academic_year: realClass.academic_year, created_at: '2026-09-19T00:00:00.000Z' },
    ],
    dictationResults: [
      { id: 'R-OLD-1', tenant_id: 'x', dictation_id: 'D-OLD-1', student_id: 'S-OLD-1', passed: 1, retest_required: 0, retest_completed: 0, created_at: '2026-09-19T00:00:00.000Z' },
      { id: 'R-OLD-2', tenant_id: 'x', dictation_id: 'D-OLD-1', student_id: 'S-OLD-2', passed: 0, retest_required: 1, retest_completed: 0, created_at: '2026-09-19T00:00:00.000Z' },
    ],
  };

  const mig = await fetch(`${BASE}/admin/migrate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ target_tenant_id: tenantId, backup, mode: 'merge' }) }).then(j);
  console.log('migrate:', JSON.stringify(mig.data));

  // 断言
  const classes2 = (await fetch(`${BASE}/classes`, { headers: H }).then(j)).data.classes;
  const students2 = (await fetch(`${BASE}/students`, { headers: H }).then(j)).data.students;
  const dicts = (await fetch(`${BASE}/dictations`, { headers: H }).then(j)).data.list;
  const det = dicts.length ? (await fetch(`${BASE}/dictations/${dicts[0].id}`, { headers: H }).then(j)).data : null;

  const p = (cond, name) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  p(classes2.filter((c) => c.name === '高三1班').length === 1, '高三1班不重复（就地更新）');
  p(classes2.some((c) => c.name === '高三2班'), '高三2班新增');
  const zhang = students2.find((s) => s.student_no === 'S001');
  p(zhang && zhang.id === realStudent.id && zhang.name === '张三丰', '张三按学号匹配就地改名更新（无重复行）');
  p(students2.some((s) => s.student_no === 'S002' && s.name === '李四'), '李四新增');
  p(zhang && zhang.class_id === realClass.id, '匹配学生挂到真实班级 id');
  const li = students2.find((s) => s.student_no === 'S002');
  p(li && li.class_id === realClass.id, '新学生 class_id 已重映射到真实班级');
  p(det && det.list && det.list.length === 2, '默写结果 2 条');
  p(det && det.list.every((r) => r.classId === realClass.id || r.classId), '结果行学生均存在');
  const r1 = det && det.list.find((r) => r.studentId === realStudent.id);
  const r2 = det && det.list.find((r) => r.studentId === li.id);
  p(!!r1 && !!r2, '默写结果 student_id 重映射到真实学生 id');
  p(dicts[0] && dicts[0].classId === realClass.id, '默写 class_id 重映射到真实班级');

  // 幂等：再导入一次，行数不膨胀
  await fetch(`${BASE}/admin/migrate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ target_tenant_id: tenantId, backup, mode: 'merge' }) }).then(j);
  const students3 = (await fetch(`${BASE}/students`, { headers: H }).then(j)).data.students;
  const classes3 = (await fetch(`${BASE}/classes`, { headers: H }).then(j)).data.classes;
  p(students3.length === students2.length && classes3.length === classes2.length, '重复增量导入幂等（不膨胀）');
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
