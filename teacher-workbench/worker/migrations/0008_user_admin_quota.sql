-- 0008_user_admin_quota.sql — 按用户配额覆盖 + 平台管理员管理

-- 成员软删除（移除保留数据、可恢复）需要维护移除时间
ALTER TABLE memberships ADD COLUMN updated_at TEXT;

-- 按用户配额：owner/admin 可对单个成员设置某资源的上限（NULL 或缺行 = 不限，走租户配额）
CREATE TABLE user_quotas (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    resource TEXT NOT NULL,          -- lessons|assignments|dictations|ai|files
    quota INTEGER,                   -- 非负整数；NULL = 不限（删除覆盖）
    updated_at TEXT NOT NULL,

    PRIMARY KEY (tenant_id, user_id, resource)
);

CREATE INDEX idx_user_quotas_user ON user_quotas(tenant_id, user_id);
