-- 0026_repair_dictation_retest.sql — 旧导入数据中未通过但未标记待重默的记录
UPDATE dictation_results
SET retest_required = 1
WHERE passed = 0 AND retest_completed = 0 AND retest_required = 0;