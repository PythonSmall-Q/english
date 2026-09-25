-- 0029_cf_ai.sql — Cloudflare AI（按 credit 计费）：
-- tenants.ai_credits      租户 AI 额度（credits，REAL，平台管理员可充值/调整）
-- user_ai_settings.mode   服务方式 own|platform|cloudflare（own=自配接口不计配额）
-- user_ai_settings.cf_model  cloudflare 模式下选用的模型（须在 CF 模型目录内）
-- ai_generations.credits  该次生成实际扣减的 credits（cloudflare 模式计费）
ALTER TABLE tenants ADD COLUMN ai_credits REAL NOT NULL DEFAULT 0;
ALTER TABLE user_ai_settings ADD COLUMN mode TEXT NOT NULL DEFAULT 'own';
ALTER TABLE user_ai_settings ADD COLUMN cf_model TEXT;
ALTER TABLE ai_generations ADD COLUMN credits REAL;
