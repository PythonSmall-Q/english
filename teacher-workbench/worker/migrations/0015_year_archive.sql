-- 0015_year_archive.sql — 学年数据归档表
-- 每年 10 月 1 日（北京时间凌晨）定时任务将上一学年的默写/作业/考试列表数据
-- （含统计）gzip+base64 压缩存入本表，随后删除对应学年明细行；
-- 查看历史学年列表时从 payload 解压还原展示（每行带 archived:true）。
-- 教案（lessons）与备课素材不参与归档。

CREATE TABLE year_archives (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  -- 模块：dictations / assignments / exams
  module TEXT NOT NULL CHECK (module IN ('dictations', 'assignments', 'exams')),
  -- 归档的学年，如 '2025-2026'
  academic_year TEXT NOT NULL,
  -- gzip+base64 的 JSON：{ version: 1, archivedAt, items: [...列表行...] }，每行注入 archived:true
  payload TEXT NOT NULL,
  -- 归档的列表行数
  item_count INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT NOT NULL
);

-- 每租户每模块每学年最多一条归档（归档幂等：已存在则跳过该模块）
CREATE UNIQUE INDEX idx_year_archives_unique ON year_archives(tenant_id, module, academic_year);
-- 按租户 + 学年查询归档
CREATE INDEX idx_year_archives_tenant_year ON year_archives(tenant_id, academic_year);
