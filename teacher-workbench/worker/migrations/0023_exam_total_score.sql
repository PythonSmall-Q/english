-- 0023_exam_total_score.sql — 考试总分（可选）
-- 为空时保留旧行为：分析/均分校验可从已导入成绩或小分推断。

ALTER TABLE exams ADD COLUMN total_score REAL;