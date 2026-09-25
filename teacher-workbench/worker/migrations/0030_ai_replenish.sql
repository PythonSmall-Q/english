-- 0030_ai_replenish.sql — AI 额度月度补足与加赠池
-- ai_credits        当前可用余额（= 基础池 + 加赠池）
-- ai_credits_monthly 月度限额：每月首次使用自动补足到「限额 + 加赠余额」；NULL = 不自动补足
-- ai_credits_bonus  管理员手动加的加赠余额（只减不补；扣费先用基础池）
-- ai_credits_period 上次补足的月份（YYYY-MM）
ALTER TABLE tenants ADD COLUMN ai_credits_monthly REAL;
ALTER TABLE tenants ADD COLUMN ai_credits_bonus REAL NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN ai_credits_period TEXT;
