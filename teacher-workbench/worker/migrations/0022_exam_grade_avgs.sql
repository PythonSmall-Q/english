-- 0022_exam_grade_avgs.sql — 年级均分（交接文档 §三-8 的通用化版）
-- 每场考试存一个 {班级名: 平均分} 的 JSON 映射（grade_avgs），
-- 供成绩分析页做全年级各班均分对比；null 值表示该项已清空（回退自动计算/无数据）。

ALTER TABLE exams ADD COLUMN grade_avgs TEXT;
