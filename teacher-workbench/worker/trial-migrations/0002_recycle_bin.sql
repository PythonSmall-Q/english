-- 0002_recycle_bin.sql — 回收站：同主库 0020_recycle_bin.sql
-- 删除的内容先进回收站（payload 存全量行 JSON），可恢复，30 天后自动清除
-- （试用库由 purgeExpiredTrials 随空间整体物理删除，不做到期清理任务）。

CREATE TABLE recycle_bin (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  item_type TEXT NOT NULL,   -- lesson 教案 / student 学生 / assignment 作业 / dictation 默写 / exam 考试
  item_id TEXT NOT NULL,
  title TEXT,
  payload TEXT NOT NULL,
  deleted_by TEXT,
  deleted_at TEXT NOT NULL
);

-- 按租户列出回收站（deleted_at 倒序）
CREATE INDEX idx_recycle_tenant ON recycle_bin(tenant_id, deleted_at);
