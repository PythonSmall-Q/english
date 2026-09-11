-- 0004_tenant_lifecycle.sql — 租户生命周期：到期日期 + 成员数配额

ALTER TABLE tenants ADD COLUMN expires_at TEXT;
ALTER TABLE tenant_quotas ADD COLUMN max_members INTEGER;
