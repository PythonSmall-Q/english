-- 0021_assignments_pinned.sql — 作业支持「📌 置顶」
-- pinned: 1 = 置顶（该班列表排最前、卡片显示置顶角标），0 = 普通（默认）
-- 存量行全部视为未置顶

ALTER TABLE assignments ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
