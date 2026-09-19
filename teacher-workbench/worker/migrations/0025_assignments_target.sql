-- 0025_assignments_target.sql — 作业「指定名单」（部分学生提交）
-- target_ids: JSON 数组学生 id（名单内学生才需提交、计未交；不在名单内不计未交）；NULL = 全班

ALTER TABLE assignments ADD COLUMN target_ids TEXT;
