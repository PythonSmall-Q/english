-- 0024_ai_billing.sql — AI 配额计费口径：自配接口的调用不计入配额
-- billed=1：走平台接口/mock，计入 AI 月度配额；billed=0：用户自配接口调用，不计配额
ALTER TABLE ai_generations ADD COLUMN billed INTEGER NOT NULL DEFAULT 1;
