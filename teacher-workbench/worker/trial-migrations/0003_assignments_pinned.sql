-- 0003_assignments_pinned.sql — 试用库补 assignments.pinned（与主库 0021 对齐）
-- trial-migrations/0001 编写时主库尚无 0021，试用库缺该列会导致试用空间建作业 500。

ALTER TABLE assignments ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
