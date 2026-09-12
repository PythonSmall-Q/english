-- 0001_graduated.sql — 毕业归档库（GRAD_DB，独立于主库）
-- 学年初结转时，毕业班级全部数据（班级+学生+作业及提交+默写及结果+考试及成绩小分）
-- 压缩打包（gzip+base64）写入本表，随后从主库删除该班数据。
-- 平台内不可查看任何内容，仅提供元数据列表与下载（envelope 与学年归档同格式）。

CREATE TABLE graduated_archives (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  class_name TEXT NOT NULL,
  graduation_year INTEGER,
  academic_year TEXT NOT NULL,
  payload TEXT NOT NULL,
  student_count INTEGER DEFAULT 0,
  archived_at TEXT NOT NULL
);

CREATE INDEX idx_graduated_tenant ON graduated_archives(tenant_id);
