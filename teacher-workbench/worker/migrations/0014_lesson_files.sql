-- 0014_lesson_files.sql — 备课中心第二轮：教案附件关联表
-- 教案附件关联：files 表已存在（id/tenant_id/file_name/file_key/mime_type/size/created_by/created_at），
-- 本表只做 lesson ↔ file 的多对多关联，删除关联不删除 files/R2 本体

CREATE TABLE lesson_files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 按教案查附件
CREATE INDEX idx_lesson_files_lesson ON lesson_files(lesson_id);
