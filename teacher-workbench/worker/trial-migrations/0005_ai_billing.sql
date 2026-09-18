-- 0005_ai_billing.sql — 试用库同步：AI 计费口径（同主库 0024）
ALTER TABLE ai_generations ADD COLUMN billed INTEGER NOT NULL DEFAULT 1;
