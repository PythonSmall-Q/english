-- 0019_trial.sql — 3 天试用
-- trial_used: 是否已创建过试用空间，一生一次（创建过即不可再建，即使上次试用数据已删）。

ALTER TABLE users ADD COLUMN trial_used INTEGER NOT NULL DEFAULT 0;
