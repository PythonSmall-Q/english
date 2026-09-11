-- 0007_class_teachers.sql — 任课老师：班级任课教师关联（任课 = 该班写权限）

CREATE TABLE class_teachers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    subject TEXT,
    created_at TEXT NOT NULL,

    UNIQUE(class_id, user_id)
);

CREATE INDEX idx_class_teachers_class ON class_teachers(tenant_id, class_id);
CREATE INDEX idx_class_teachers_user ON class_teachers(tenant_id, user_id);
