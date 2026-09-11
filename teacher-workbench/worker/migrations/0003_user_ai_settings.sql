-- 0003_user_ai_settings.sql — 用户级 AI Provider 配置（端点/密钥/模型，设置页可维护）

CREATE TABLE user_ai_settings (
    user_id TEXT PRIMARY KEY,
    base_url TEXT,
    api_key TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
