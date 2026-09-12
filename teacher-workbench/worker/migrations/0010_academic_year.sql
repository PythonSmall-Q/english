-- 0010_academic_year.sql — 教学数据按学年归档（§学年归档）
-- 7 张归属表加 academic_year 列并按东八区当前日期回填，子表（exam_scores/exam_subscores/
-- assignment_submissions/dictation_results）随父记录，不加列。

-- 1. 加列（classes 已有该列）
ALTER TABLE students ADD COLUMN academic_year TEXT;
ALTER TABLE lessons ADD COLUMN academic_year TEXT;
ALTER TABLE schedules ADD COLUMN academic_year TEXT;
ALTER TABLE assignments ADD COLUMN academic_year TEXT;
ALTER TABLE dictations ADD COLUMN academic_year TEXT;
ALTER TABLE exams ADD COLUMN academic_year TEXT;

-- 2. 回填：东八区（datetime('now','+8 hours')）当前日期计算学年字符串，
--    9–12 月为当年-次年，否则为去年-当年；仅回填 NULL 行
UPDATE classes SET academic_year = CASE
  WHEN CAST(strftime('%m', datetime('now', '+8 hours')) AS INTEGER) >= 9
  THEN strftime('%Y', datetime('now', '+8 hours')) || '-' || (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) + 1)
  ELSE (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) - 1) || '-' || strftime('%Y', datetime('now', '+8 hours'))
END WHERE academic_year IS NULL;

UPDATE students SET academic_year = CASE
  WHEN CAST(strftime('%m', datetime('now', '+8 hours')) AS INTEGER) >= 9
  THEN strftime('%Y', datetime('now', '+8 hours')) || '-' || (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) + 1)
  ELSE (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) - 1) || '-' || strftime('%Y', datetime('now', '+8 hours'))
END WHERE academic_year IS NULL;

UPDATE lessons SET academic_year = CASE
  WHEN CAST(strftime('%m', datetime('now', '+8 hours')) AS INTEGER) >= 9
  THEN strftime('%Y', datetime('now', '+8 hours')) || '-' || (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) + 1)
  ELSE (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) - 1) || '-' || strftime('%Y', datetime('now', '+8 hours'))
END WHERE academic_year IS NULL;

UPDATE schedules SET academic_year = CASE
  WHEN CAST(strftime('%m', datetime('now', '+8 hours')) AS INTEGER) >= 9
  THEN strftime('%Y', datetime('now', '+8 hours')) || '-' || (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) + 1)
  ELSE (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) - 1) || '-' || strftime('%Y', datetime('now', '+8 hours'))
END WHERE academic_year IS NULL;

UPDATE assignments SET academic_year = CASE
  WHEN CAST(strftime('%m', datetime('now', '+8 hours')) AS INTEGER) >= 9
  THEN strftime('%Y', datetime('now', '+8 hours')) || '-' || (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) + 1)
  ELSE (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) - 1) || '-' || strftime('%Y', datetime('now', '+8 hours'))
END WHERE academic_year IS NULL;

UPDATE dictations SET academic_year = CASE
  WHEN CAST(strftime('%m', datetime('now', '+8 hours')) AS INTEGER) >= 9
  THEN strftime('%Y', datetime('now', '+8 hours')) || '-' || (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) + 1)
  ELSE (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) - 1) || '-' || strftime('%Y', datetime('now', '+8 hours'))
END WHERE academic_year IS NULL;

UPDATE exams SET academic_year = CASE
  WHEN CAST(strftime('%m', datetime('now', '+8 hours')) AS INTEGER) >= 9
  THEN strftime('%Y', datetime('now', '+8 hours')) || '-' || (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) + 1)
  ELSE (CAST(strftime('%Y', datetime('now', '+8 hours')) AS INTEGER) - 1) || '-' || strftime('%Y', datetime('now', '+8 hours'))
END WHERE academic_year IS NULL;

-- 3. 索引：(tenant_id, academic_year) 供学年过滤列表查询
CREATE INDEX idx_classes_year ON classes(tenant_id, academic_year);
CREATE INDEX idx_students_year ON students(tenant_id, academic_year);
CREATE INDEX idx_lessons_year ON lessons(tenant_id, academic_year);
CREATE INDEX idx_schedules_year ON schedules(tenant_id, academic_year);
CREATE INDEX idx_assignments_year ON assignments(tenant_id, academic_year);
CREATE INDEX idx_dictations_year ON dictations(tenant_id, academic_year);
CREATE INDEX idx_exams_year ON exams(tenant_id, academic_year);
