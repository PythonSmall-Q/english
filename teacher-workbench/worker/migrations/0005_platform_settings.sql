-- 0005_platform_settings.sql — 平台级设置（如：新建账户是否自动创建个人空间）

CREATE TABLE platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL
);
