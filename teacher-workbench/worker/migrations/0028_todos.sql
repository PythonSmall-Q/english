-- 0028_todos.sql — 待办中心：个人/年级组/学科组三级待办
-- scope：personal=个人（仅创建者可见）；grade=年级组（组长发布，组内老师可见）；subject=备课组（备课组长发布，组内老师可见）

CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'personal',
    group_id TEXT,
    title TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_todos_tenant ON todos(tenant_id, scope, group_id);
