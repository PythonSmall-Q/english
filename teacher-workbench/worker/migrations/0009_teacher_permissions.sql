-- 0009_teacher_permissions.sql — 教师级权限开关（create_classes/create_students/create_exams）
-- 语义：无记录 = 允许；allowed=0 表示 owner/admin 显式关闭某权限；owner/admin 不受此表约束。

CREATE TABLE user_permissions (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    perm TEXT NOT NULL,              -- create_classes|create_students|create_exams
    allowed INTEGER NOT NULL,        -- 0 = 显式关闭；无记录 = 允许
    updated_at TEXT NOT NULL,

    PRIMARY KEY (tenant_id, user_id, perm)
);

CREATE INDEX idx_user_permissions_user ON user_permissions(tenant_id, user_id);
