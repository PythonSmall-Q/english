-- 英语教师教学工作台 V3 · D1 初始化迁移
-- 表结构与字段严格按设计文档 §15-§19、§23-§38、§63、§75
-- 约定：所有 id 为 TEXT PRIMARY KEY（crypto.randomUUID）；
--       所有业务表带 tenant_id；时间戳为 ISO 字符串（new Date().toISOString()）。

-- 用户（§15）
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT 'Lynn',
    platform_role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 服务端 Session（§14）：token 只存 SHA-256 哈希，原始 token 只通过 HttpOnly Cookie 下发
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 租户（§16），type: personal | organization
CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 用户与租户的多对多关系（§17）
CREATE TABLE memberships (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,

    UNIQUE(tenant_id, user_id)
);

-- 租户配额（§19）
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

-- 班级（§24）
CREATE TABLE classes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    grade TEXT,
    academic_year TEXT,
    teacher_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 学生（§25）
CREATE TABLE students (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    student_no TEXT,
    name TEXT NOT NULL,
    gender TEXT,
    status TEXT DEFAULT 'normal',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 教案（§26）
CREATE TABLE lessons (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    class_id TEXT,
    title TEXT NOT NULL,
    lesson_type TEXT,
    objective TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 教学课表（§27）
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 作业（§29）
CREATE TABLE assignments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    deadline TEXT,
    status TEXT DEFAULT 'active',
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

-- 默写（§33）
CREATE TABLE dictations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    class_id TEXT,
    title TEXT NOT NULL,
    scope TEXT DEFAULT 'class',
    material_url TEXT,
    dictation_date TEXT,
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

-- 考试（§36）
CREATE TABLE exams (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    subject TEXT,
    exam_date TEXT,
    paper_url TEXT,
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

-- ============ 索引（§80 + 补充） ============

-- 租户级成员/配额/邀请查询
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);          -- §80
CREATE INDEX idx_memberships_tenant ON memberships(tenant_id);      -- §80
CREATE INDEX idx_invitations_tenant ON invitations(tenant_id);
CREATE INDEX idx_invitations_token ON invitations(token_hash);
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);

-- 各业务表 tenant_id 单列索引
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
CREATE INDEX idx_ai_generations_tenant ON ai_generations(tenant_id);

-- 组合索引（§80）
CREATE INDEX idx_students_class ON students(tenant_id, class_id);
CREATE INDEX idx_assignments_class ON assignments(tenant_id, class_id);
CREATE INDEX idx_submissions_assignment ON assignment_submissions(tenant_id, assignment_id);
CREATE INDEX idx_exam_scores_exam ON exam_scores(tenant_id, exam_id);
CREATE INDEX idx_exam_subscores_exam ON exam_subscores(tenant_id, exam_id);
CREATE INDEX idx_dictation_results_dictation ON dictation_results(tenant_id, dictation_id);
