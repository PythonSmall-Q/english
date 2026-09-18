-- 0004_students_exempt.sql — 试用库补 students.exempt（与主库 0023 对齐）
-- exempt: 1=豁免登记（不参与作业/默写登记、重默、预警与统计导出/汇总分析）

ALTER TABLE students ADD COLUMN exempt INTEGER NOT NULL DEFAULT 0;
