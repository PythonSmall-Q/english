-- 0001_trial.sql — 试用租户独立库（TRIAL_DB）初始迁移
-- 试用租户（plan='trial'）的租户行、成员关系、配额与全部业务数据只存本库；
-- 主库 DB 不再存任何试用数据。users/sessions/platform_settings/user_ai_settings/
-- graduated_archives 等全局表永远在主库，本库不建。
-- 表结构 = 主库 0001–0019 各迁移累积后的最终版（含 plan/expires_at/max_members/
-- academic_year/scope/archived_stats/content/graduation_year 等全部累积列）。
-- 另含 grade_group_prep_leaders / lesson_files 两张运行期必需表（路由会直接查询，
-- 缺表会导致试用租户 500）。year_archives 建空表，防止归档端点查缺表。
-- 约定同主库：id 为 TEXT PRIMARY KEY；时间戳为 ISO 字符串；业务表带 tenant_id。

-- 租户（§16 最终版：含套餐 plan 与到期日 expires_at）
CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    plan TEXT,                    -- 定价套餐 free|pro|school|custom；本库恒为 'trial'
    expires_at TEXT,              -- 到期时间（ISO 字符串），到期只读、到期即销毁
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 用户与租户的多对多关系（§17 最终版：含软删除时间 updated_at）
-- 注意：user_id 指向主库 users 行，本库不做外键（全局用户表永远在主库）
CREATE TABLE memberships (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT,

    UNIQUE(tenant_id, user_id)
);

-- 租户配额（§19 最终版：含成员数上限 max_members）
CREATE TABLE tenant_quotas (
    tenant_id TEXT PRIMARY KEY,

    max_classes INTEGER,
    max_students INTEGER,
    max_lessons INTEGER,
    max_assignments INTEGER,
    max_dictations INTEGER,
    max_exams INTEGER,

    max_storage_bytes INTEGER,

    max_ai_requests_month INTEGER,

    max_members INTEGER,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 邀请（§75）
CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 班级（§24 最终版：含 grade_group_id / academic_year / graduation_year）
CREATE TABLE classes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    grade TEXT,
    academic_year TEXT,
    teacher_id TEXT,
    grade_group_id TEXT,          -- 归属年级组（0006）
    graduation_year INTEGER,      -- 毕业年份（0017），NULL = 不毕业
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 学生（§25 最终版：含 academic_year）
CREATE TABLE students (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    student_no TEXT,
    name TEXT NOT NULL,
    gender TEXT,
    status TEXT DEFAULT 'normal',
    notes TEXT,
    academic_year TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 教案（§26 最终版：含正文 content 与学年）
CREATE TABLE lessons (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    class_id TEXT,
    title TEXT NOT NULL,
    lesson_type TEXT,
    objective TEXT,
    content TEXT,                 -- 教案正文（0013）
    status TEXT DEFAULT 'pending',
    academic_year TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 教案附件关联（0014）：lesson ↔ file 多对多，仅关联不持有文件本体
CREATE TABLE lesson_files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 教学课表（§27 最终版：含 lesson_type / academic_year）
CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT,
    class_id TEXT,
    weekday INTEGER NOT NULL,
    period INTEGER,
    start_time TEXT,
    end_time TEXT,
    title TEXT,
    lesson_type TEXT,
    classroom TEXT,
    scope TEXT DEFAULT 'class',
    academic_year TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 作业（§29 最终版：含 academic_year 与归档汇总 archived_stats）
CREATE TABLE assignments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    deadline TEXT,
    status TEXT DEFAULT 'active',
    academic_year TEXT,
    archived_stats TEXT,          -- 归档汇总 JSON（0016）
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 作业提交记录（§29）
CREATE TABLE assignment_submissions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at TEXT,
    created_at TEXT NOT NULL,

    UNIQUE(assignment_id, student_id)
);

-- 默写（§33 最终版：含 scope / academic_year / archived_stats）
CREATE TABLE dictations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    class_id TEXT,
    title TEXT NOT NULL,
    scope TEXT DEFAULT 'class',
    material_url TEXT,
    dictation_date TEXT,
    academic_year TEXT,
    archived_stats TEXT,          -- 归档汇总 JSON（0016）
    created_at TEXT NOT NULL
);

-- 默写结果（§34）
CREATE TABLE dictation_results (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    dictation_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    passed INTEGER DEFAULT 0,
    retest_required INTEGER DEFAULT 0,
    retest_completed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,

    UNIQUE(dictation_id, student_id)
);

-- 考试（§36 最终版：含 academic_year / scope / class_id / archived_stats）
CREATE TABLE exams (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    subject TEXT,
    exam_date TEXT,
    paper_url TEXT,
    academic_year TEXT,
    scope TEXT NOT NULL DEFAULT 'grade',  -- class=班级考试 | grade=全年段考试（0011）
    class_id TEXT,                        -- scope='class' 时归属班级（0011）
    archived_stats TEXT,                  -- 归档汇总 JSON（0016）
    created_at TEXT NOT NULL
);

-- 考试成绩（§37）
CREATE TABLE exam_scores (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    score REAL,
    created_at TEXT NOT NULL,

    UNIQUE(exam_id, student_id)
);

-- 考试小分（§38）
CREATE TABLE exam_subscores (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    question_type TEXT NOT NULL,
    score REAL,
    max_score REAL,
    created_at TEXT NOT NULL
);

-- 文件元数据（§46）：R2 存文件本体，D1 存 metadata
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_key TEXT NOT NULL UNIQUE,
    mime_type TEXT,
    size INTEGER,
    created_by TEXT,
    created_at TEXT NOT NULL
);

-- 年级组（0006）：组 → 组长（本年级子管理员）→ 归属班级
CREATE TABLE grade_groups (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    leader_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 备课组长（0012）：与年级组长同权发布/管理全年段默写与考试
CREATE TABLE grade_group_prep_leaders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(group_id, user_id)
);

-- 任课老师（0007）：班级任课教师关联（任课 = 该班写权限）
CREATE TABLE class_teachers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    subject TEXT,
    created_at TEXT NOT NULL,

    UNIQUE(class_id, user_id)
);

-- 按用户配额覆盖（0008）：NULL 或缺行 = 不限，走租户配额
CREATE TABLE user_quotas (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    resource TEXT NOT NULL,          -- lessons|assignments|dictations|ai|files
    quota INTEGER,                   -- 非负整数；NULL = 不限（删除覆盖）
    updated_at TEXT NOT NULL,

    PRIMARY KEY (tenant_id, user_id, resource)
);

-- 教师级权限开关（0009）：无记录 = 允许；allowed=0 表示 owner/admin 显式关闭
CREATE TABLE user_permissions (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    perm TEXT NOT NULL,              -- create_classes|create_students|create_exams
    allowed INTEGER NOT NULL,        -- 0 = 显式关闭；无记录 = 允许
    updated_at TEXT NOT NULL,

    PRIMARY KEY (tenant_id, user_id, perm)
);

-- AI 生成记录（§43）
CREATE TABLE ai_generations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT,
    result TEXT,
    created_at TEXT NOT NULL
);

-- 审计日志（§63）
CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
);

-- 学年数据归档（0015/0016）：建空表即可，防止归档端点查询缺表报错
CREATE TABLE year_archives (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('dictations', 'assignments', 'exams')),
  academic_year TEXT NOT NULL,
  payload TEXT NOT NULL,           -- gzip+base64 的 JSON
  item_count INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT NOT NULL
);

-- ============ 索引（与主库 0001–0015 累积索引一致） ============

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_tenant ON memberships(tenant_id);
CREATE INDEX idx_invitations_tenant ON invitations(tenant_id);
CREATE INDEX idx_invitations_token ON invitations(token_hash);
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);

CREATE INDEX idx_classes_tenant ON classes(tenant_id);
CREATE INDEX idx_students_tenant ON students(tenant_id);
CREATE INDEX idx_lessons_tenant ON lessons(tenant_id);
CREATE INDEX idx_schedules_tenant ON schedules(tenant_id);
CREATE INDEX idx_assignments_tenant ON assignments(tenant_id);
CREATE INDEX idx_assignment_submissions_tenant ON assignment_submissions(tenant_id);
CREATE INDEX idx_dictations_tenant ON dictations(tenant_id);
CREATE INDEX idx_dictation_results_tenant ON dictation_results(tenant_id);
CREATE INDEX idx_exams_tenant ON exams(tenant_id);
CREATE INDEX idx_exam_scores_tenant ON exam_scores(tenant_id);
CREATE INDEX idx_exam_subscores_tenant ON exam_subscores(tenant_id);
CREATE INDEX idx_files_tenant ON files(tenant_id);
CREATE INDEX idx_ai_generations_tenant ON ai_generations(tenant_id);
CREATE INDEX idx_grade_groups_tenant ON grade_groups(tenant_id);
CREATE INDEX idx_grade_group_prep_leaders_tenant_user ON grade_group_prep_leaders(tenant_id, user_id);
CREATE INDEX idx_class_teachers_class ON class_teachers(tenant_id, class_id);
CREATE INDEX idx_class_teachers_user ON class_teachers(tenant_id, user_id);
CREATE INDEX idx_user_quotas_user ON user_quotas(tenant_id, user_id);
CREATE INDEX idx_user_permissions_user ON user_permissions(tenant_id, user_id);

-- 组合索引（§80）
CREATE INDEX idx_students_class ON students(tenant_id, class_id);
CREATE INDEX idx_assignments_class ON assignments(tenant_id, class_id);
CREATE INDEX idx_submissions_assignment ON assignment_submissions(tenant_id, assignment_id);
CREATE INDEX idx_exam_scores_exam ON exam_scores(tenant_id, exam_id);
CREATE INDEX idx_exam_subscores_exam ON exam_subscores(tenant_id, exam_id);
CREATE INDEX idx_dictation_results_dictation ON dictation_results(tenant_id, dictation_id);

-- 学年过滤索引（0010）
CREATE INDEX idx_classes_year ON classes(tenant_id, academic_year);
CREATE INDEX idx_students_year ON students(tenant_id, academic_year);
CREATE INDEX idx_lessons_year ON lessons(tenant_id, academic_year);
CREATE INDEX idx_schedules_year ON schedules(tenant_id, academic_year);
CREATE INDEX idx_assignments_year ON assignments(tenant_id, academic_year);
CREATE INDEX idx_dictations_year ON dictations(tenant_id, academic_year);
CREATE INDEX idx_exams_year ON exams(tenant_id, academic_year);

-- 按班级查班级考试（0011）
CREATE INDEX idx_exams_class ON exams(tenant_id, class_id);

-- 按教案查附件（0014）
CREATE INDEX idx_lesson_files_lesson ON lesson_files(lesson_id);

-- 归档唯一性与查询索引（0015）
CREATE UNIQUE INDEX idx_year_archives_unique ON year_archives(tenant_id, module, academic_year);
CREATE INDEX idx_year_archives_tenant_year ON year_archives(tenant_id, academic_year);
