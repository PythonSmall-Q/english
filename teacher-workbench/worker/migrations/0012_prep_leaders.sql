-- 0012_prep_leaders.sql — 备课组长：年级组长可在本年级组内设置备课组长（每组不限人数）
-- 备课组长与年级组长同权发布/管理全年段默写与全年段考试

CREATE TABLE grade_group_prep_leaders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(group_id, user_id)
);

CREATE INDEX idx_grade_group_prep_leaders_tenant_user ON grade_group_prep_leaders(tenant_id, user_id);
