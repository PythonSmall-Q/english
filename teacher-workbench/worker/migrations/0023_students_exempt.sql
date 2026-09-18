-- 0023_students_exempt.sql — 学生豁免登记（交接文档 §3.5.4：郑紫诺从作业/默写登记与导出中豁免，但保留在学生管理）
-- exempt: 1=豁免登记（不参与作业/默写登记、重默、预警与统计导出/汇总分析）

ALTER TABLE students ADD COLUMN exempt INTEGER NOT NULL DEFAULT 0;
