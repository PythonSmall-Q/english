-- 0002_files.sql — 文件元数据表（§46：R2 上线，D1 存 metadata，R2 存文件本体）

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

CREATE INDEX idx_files_tenant ON files(tenant_id);
