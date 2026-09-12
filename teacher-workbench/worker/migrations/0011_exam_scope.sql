-- 0011_exam_scope.sql — 考试区分「班级考试」与「全年段考试」
-- scope: 'class'（属于某个班，任课老师/班主任创建）| 'grade'（全年段，年级组长/管理员创建）
-- 存量数据无 scope 概念，一律视为全年段（'grade'）

ALTER TABLE exams ADD COLUMN scope TEXT NOT NULL DEFAULT 'grade';
ALTER TABLE exams ADD COLUMN class_id TEXT;

-- 存量行兜底（列带 NOT NULL DEFAULT，理论上不会为 NULL，双保险）
UPDATE exams SET scope = 'grade' WHERE scope IS NULL;

-- 按班级查班级考试
CREATE INDEX idx_exams_class ON exams(tenant_id, class_id);
