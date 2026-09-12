-- 0018_tenant_plan.sql — 租户定价套餐
-- plan: 定价套餐 free|pro|school|custom；NULL/custom = 商议（手动配额，走现有行为）。
-- free/pro/school 创建时按 PLAN_PRESETS 写入 tenant_quotas 与 max_members。

ALTER TABLE tenants ADD COLUMN plan TEXT;
