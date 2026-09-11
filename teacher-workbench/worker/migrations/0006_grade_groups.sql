-- 0006_grade_groups.sql — 年级组：组→组长（本年级子管理员）→归属班级

CREATE TABLE grade_groups (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    leader_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_grade_groups_tenant ON grade_groups(tenant_id);

-- 班级归属年级组
ALTER TABLE classes ADD COLUMN grade_group_id TEXT;
