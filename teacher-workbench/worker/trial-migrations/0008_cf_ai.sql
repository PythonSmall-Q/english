-- 0008_cf_ai.sql — 试用库同步：Cloudflare AI 计费（同主库 0029）
-- tenants.ai_credits      租户 AI 额度（credits，REAL）
-- ai_generations.credits  该次生成实际扣减的 credits
ALTER TABLE tenants ADD COLUMN ai_credits REAL NOT NULL DEFAULT 0;
ALTER TABLE ai_generations ADD COLUMN credits REAL;
