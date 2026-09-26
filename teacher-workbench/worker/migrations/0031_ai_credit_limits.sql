-- 0031_ai_credit_limits.sql — 放宽旧版 AI credit 月度档位
-- 只迁移系统旧默认值，不覆盖管理员已经自定义的其他额度。
UPDATE tenants
SET ai_credits_monthly = CASE ai_credits_monthly
  WHEN 10 THEN 100
  WHEN 20 THEN 100
  WHEN 100 THEN 1000
  WHEN 500 THEN 5000
  ELSE ai_credits_monthly
END
WHERE ai_credits_monthly IN (10, 20, 100, 500);